import { deflateSync, inflateSync, strFromU8, strToU8, zipSync } from 'fflate';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { AGENT_HOME, CONFIG_DIR, defaultConfig, type File } from './generate';
import { fromToml, problems, strings, table, text, toToml } from './module';
import type { Resolution } from './resolve';
import type { Config, Doc, Engine } from './types';

// --- encoding ----------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): Uint8Array {
	const binary = atob(data.replaceAll('-', '+').replaceAll('_', '/'));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** deflate + base64url, for URL fragments. */
export const pack = (value: string) => toBase64Url(deflateSync(strToU8(value), { level: 9 }));
export const unpack = (data: string) => strFromU8(inflateSync(fromBase64Url(data)));

// --- links -------------------------------------------------------------------

/** Settings for the link: only what differs from the defaults, never secrets. */
export function storedSettings(config: Config, engines: Engine[], secrets: Set<string>): Partial<Config> {
	const defaults = defaultConfig(engines);
	const stored: Record<string, unknown> = {};
	for (const key of Object.keys(defaults) as (keyof Config)[]) {
		let value: unknown = config[key];
		if (key === 'values') {
			value = Object.fromEntries(Object.entries(config.values).filter(([n, v]) => v && !secrets.has(n)));
		}
		if (JSON.stringify(value) !== JSON.stringify(defaults[key])) stored[key] = value;
	}
	return stored as Partial<Config>;
}

export type Hash = { kind: 'config'; config: Config } | { kind: 'module'; source: string } | { kind: 'none' };

export function encodeConfig(config: Config, engines: Engine[], secrets: Set<string>): string {
	return `config=${pack(JSON.stringify(storedSettings(config, engines, secrets)))}`;
}

/** A module for the `#module=` link: the file as it is. */
export function encodeModule(doc: Doc): string {
	return `module=${pack(toToml(doc))}`;
}

export function decodeHash(hash: string, engines: Engine[]): Hash {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	try {
		const module = params.get('module');
		if (module) return { kind: 'module', source: unpack(module) };
		const config = params.get('config');
		if (config) return { kind: 'config', config: normalize(JSON.parse(unpack(config)), engines) };
	} catch {
		// a broken link loads nothing
	}
	return { kind: 'none' };
}

/** Fills gaps and drops what does not fit, so hand-edited settings load. */
export function normalize(input: unknown, engines: Engine[]): Config {
	const base = defaultConfig(engines);
	const raw = table(input);
	const result = { ...base } as Record<keyof Config, unknown>;
	const stringMap = (value: unknown) =>
		Object.fromEntries(Object.entries(table(value)).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
	for (const key of Object.keys(base) as (keyof Config)[]) {
		const value = raw[key];
		if (value === undefined) continue;
		if (key === 'modules' || key === 'pins' || key === 'values') result[key] = stringMap(value);
		else if (key === 'custom') result[key] = Array.isArray(value) ? value.map(table) : [];
		else if (typeof value === typeof base[key]) result[key] = value;
	}
	return result as Config;
}

// --- what a module does, before adding it ---------------------------------------

export interface Review {
	doc: Doc;
	problems: string[];
	/** Commands that run as root. */
	root: { what: string; run: string }[];
	secrets: string[];
}

export function review(source: string, formats: number[]): Review {
	const doc = fromToml(source);
	const hooks = table(table(table(doc.mise).bootstrap).hooks);
	const root: Review['root'] = [];
	const rootHook = text(table(hooks['post-packages']).run);
	if (rootHook) root.push({ what: 'setup hook (post-packages)', run: rootHook });
	for (const [name, raw] of Object.entries(table(doc.daemons))) {
		if (table(raw).user === 'root') root.push({ what: `daemon ${name}`, run: text(table(raw).run) });
	}
	const secrets = Object.entries(table(doc.env))
		.filter(([, spec]) => table(spec).type === 'secret')
		.map(([name]) => name);
	return { doc, problems: problems(doc, formats), root, secrets };
}

// --- loading files back ------------------------------------------------------------

export interface Imported {
	config: Config;
	notes: string[];
}

type Yaml = Record<string, unknown>;

function readAgentToml(source: string, config: Config, notes: string[]) {
	const doc = parseToml(source) as Doc;
	config.modules = {};
	config.pins = {};
	for (const [name, spec] of Object.entries(table(doc.modules))) {
		if (typeof spec !== 'string') continue;
		if (spec === 'local') {
			if (!config.custom.some((m) => m.name === name)) {
				notes.push(`agent.toml enables modules/${name}.toml; load that file too.`);
			}
		} else {
			config.modules[name] = spec;
		}
	}
	config.values = Object.fromEntries(
		Object.entries(table(doc.env)).map(([name, value]) => [name, text(value)])
	);
	if (typeof doc.puid === 'number') config.puid = String(doc.puid);
	if (typeof doc.pgid === 'number') config.pgid = String(doc.pgid);
	if (typeof doc.workspace === 'string') config.workspace = doc.workspace;
	config.autoUpdate = doc.auto_update !== false;
	config.catalog = typeof doc.catalog === 'string' ? doc.catalog : '';
}

function readCompose(source: string, config: Config, files: File[]) {
	const doc = table(parseYaml(source)) as Yaml;
	const services = Object.entries(table(doc.services));
	const mounts = (svc: Yaml) => [
		...strings(svc.volumes).map((v) => v.split(':')[1] ?? ''),
		...(Array.isArray(svc.configs) ? svc.configs.map((c) => text(table(c).target)) : [])
	];
	const entry =
		services.find(([, svc]) => mounts(table(svc)).some((t) => t.startsWith(CONFIG_DIR))) ??
		services.find(([, svc]) => text(table(svc).image).includes('container-agent'));
	if (!entry) throw new Error(`No container-agent service found: none mounts ${CONFIG_DIR}.`);
	const [name, raw] = entry;
	const service = table(raw);
	config.service = name;
	config.image = text(service.image).split(':').at(-1) || config.image;
	const env = service.environment;
	config.tz = Array.isArray(env)
		? (strings(env).find((e) => e.startsWith('TZ='))?.slice(3) ?? '')
		: text(table(env).TZ);

	const volumes = strings(service.volumes).map((v) => v.split(':'));
	const hostOf = (target: string) => volumes.find((parts) => parts[1] === target)?.[0];
	const home = hostOf(AGENT_HOME);
	if (home) config.dataDir = home.replace(/\/home$/, '');
	config.sshKeys = hostOf(`${AGENT_HOME}/.ssh-keys`) ?? '';
	const repos = volumes.find((parts) => parts[0] === `${config.dataDir}/repos`);
	if (repos?.[1]) config.workspace = repos[1];

	// agent.toml and modules inside compose.yaml
	const configs = table(doc.configs);
	config.inline = false;
	for (const mount of Array.isArray(service.configs) ? service.configs : []) {
		const target = text(table(mount).target);
		const content = table(configs[text(table(mount).source)]).content;
		if (!target.startsWith(`${CONFIG_DIR}/`) || typeof content !== 'string') continue;
		config.inline = true;
		files.push({ path: target.slice(CONFIG_DIR.length + 1), text: content.replaceAll('$$', '$') });
	}
}

/**
 * Settings from files the configurator wrote: compose.yaml, agent.toml and
 * module files, in any combination. Secrets live in .env and are not read.
 */
export function importFiles(input: File[], engines: Engine[]): Imported {
	const config = defaultConfig(engines);
	const notes: string[] = [];
	const files = [...input];
	const composeFile = files.find((f) => /\.ya?ml$/.test(f.path) || /^\s*services\s*:/m.test(f.text));
	if (composeFile) readCompose(composeFile.text, config, files);

	const tomls = files.filter((f) => f !== composeFile);
	const parsed = tomls.map((f) => {
		try {
			return { file: f, doc: parseToml(f.text) as Doc };
		} catch (error) {
			throw new Error(`${f.path}: not valid TOML (${(error as Error).message})`);
		}
	});
	// modules first, so agent.toml finds them
	for (const { doc } of parsed) if (typeof doc.name === 'string') config.custom.push(doc);
	const agent = parsed.find(({ doc }) => typeof doc.name !== 'string' && ('modules' in doc || 'format' in doc));
	if (agent) readAgentToml(agent.file.text, config, notes);
	else if (!composeFile && !config.custom.length) throw new Error('Neither compose.yaml, agent.toml nor a module.');
	if (!agent && composeFile && !config.inline) {
		notes.push('compose.yaml mounts a config folder; load its agent.toml and modules too.');
	}
	return { config, notes };
}

/**
 * After loading agent.toml, modules that others require move from the picked
 * ones to the pins: they keep their version but come and go with the modules
 * that need them.
 */
export function demoteRequired(config: Config, resolution: Resolution): Config {
	const modules = { ...config.modules };
	const pins = { ...config.pins };
	for (const name of Object.keys(modules)) {
		if (resolution.requiredBy.get(name)?.some((by) => by !== name)) {
			pins[name] = modules[name];
			delete modules[name];
		}
	}
	return { ...config, modules, pins };
}

// --- download -----------------------------------------------------------------------

export function zip(files: File[], folder: string): Uint8Array {
	return zipSync(Object.fromEntries(files.map((f) => [`${folder}/${f.path}`, strToU8(f.text)])));
}
