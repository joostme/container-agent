import { parse } from 'yaml';
import { emptyCustomModule, fromToml } from './custom';
import { CUSTOM_DIR, defaultConfig, storedSettings } from './generate';
import type { Config, CustomModule, Registry } from './types';

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown): Record<string, unknown>[] =>
	Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];

function customModule(raw: Record<string, unknown>): CustomModule {
	return {
		...emptyCustomModule(str(raw.name)),
		description: str(raw.description),
		requires: Array.isArray(raw.requires) ? raw.requires.filter((r) => typeof r === 'string') : [],
		tools: list(raw.tools).map((t) => ({ name: str(t.name), version: str(t.version) })),
		packages: str(raw.packages),
		rootSetup: str(raw.rootSetup),
		userSetup: str(raw.userSetup),
		env: list(raw.env).map((v) => ({
			name: str(v.name),
			default: str(v.default),
			description: str(v.description),
			secret: v.secret === true,
			required: v.required === true,
			port: v.port === 'http' || v.port === 'tcp' ? v.port : ''
		})),
		daemons: list(raw.daemons).map((d) => ({ name: str(d.name), run: str(d.run), readyPort: str(d.readyPort) })),
		nextSteps: str(raw.nextSteps)
	};
}

/** Fills gaps and drops unknown keys, so old or hand-edited settings load. */
export function normalize(input: unknown, registry: Registry): Config {
	const base = defaultConfig(registry);
	if (!input || typeof input !== 'object') return base;
	const raw = input as Partial<Config>;
	const pick = <K extends keyof Config>(key: K): Config[K] =>
		typeof raw[key] === typeof base[key] && raw[key] !== null ? (raw[key] as Config[K]) : base[key];
	const strings = (value: unknown): Record<string, string> =>
		Object.fromEntries(
			Object.entries(value && typeof value === 'object' ? value : {}).filter(
				([, v]) => typeof v === 'string'
			)
		) as Record<string, string>;
	return {
		modules: Array.isArray(raw.modules) ? raw.modules.filter((m) => typeof m === 'string') : [],
		values: strings(raw.values),
		custom: list(raw.custom).map(customModule),
		service: pick('service'),
		imageTag: pick('imageTag'),
		puid: pick('puid'),
		pgid: pick('pgid'),
		tz: pick('tz'),
		agentUser: pick('agentUser'),
		dataDir: pick('dataDir'),
		sshKeys: pick('sshKeys'),
		autoUpdate: pick('autoUpdate')
	};
}

function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
	const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
	return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** URL hash of the configuration, without secrets. */
export function encodeHash(config: Config, registry: Registry): string {
	return toBase64Url(JSON.stringify(storedSettings(config, registry)));
}

export function decodeHash(hash: string, registry: Registry): Config | null {
	const text = hash.replace(/^#/, '');
	if (!text) return null;
	try {
		return normalize(JSON.parse(fromBase64Url(text)), registry);
	} catch {
		return null;
	}
}

type Doc = Record<string, unknown>;
const obj = (v: unknown): Doc => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {});

/** environment: as a map or as a list of NAME=value. */
function environmentOf(service: Doc): Record<string, string> {
	const env = service.environment;
	if (Array.isArray(env)) {
		return Object.fromEntries(
			env
				.filter((e): e is string => typeof e === 'string' && e.includes('='))
				.map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)])
		);
	}
	return Object.fromEntries(Object.entries(obj(env)).map(([k, v]) => [k, v == null ? '' : String(v)]));
}

const BASE_VARS = new Set(['PUID', 'PGID', 'TZ', 'AGENT_USER', 'AUTO_UPDATE', 'AGENT_MODULES']);

/**
 * Settings from a compose.yaml of container-agent, read from the file itself:
 * the service with AGENT_MODULES, its environment, volumes and the custom
 * modules mounted with configs. Secrets stay in .env and are not read.
 */
export function importCompose(text: string, registry: Registry): Config {
	let doc: Doc;
	try {
		doc = obj(parse(text));
	} catch (error) {
		throw new Error(`Not valid YAML: ${(error as Error).message}`);
	}
	const entry = Object.entries(obj(doc.services)).find(([, svc]) => 'AGENT_MODULES' in environmentOf(obj(svc)));
	if (!entry) throw new Error('No container-agent service found: none sets AGENT_MODULES.');
	const [serviceName, rawService] = entry;
	const service = obj(rawService);
	const env = environmentOf(service);
	const base = defaultConfig(registry);
	const agentUser = env.AGENT_USER || base.agentUser;
	const home = `/home/${agentUser}`;

	// custom modules: the two files mounted per module under CUSTOM_DIR
	const configs = obj(doc.configs);
	const files = new Map<string, Record<string, string>>();
	for (const mount of Array.isArray(service.configs) ? service.configs : []) {
		const target = String(obj(mount).target ?? '');
		const match = target.match(new RegExp(`^${CUSTOM_DIR}/([^/]+)/(module|mise)\\.toml$`));
		const content = obj(configs[String(obj(mount).source ?? '')]).content;
		if (!match || typeof content !== 'string') continue;
		files.set(match[1], { ...files.get(match[1]), [match[2]]: content.replaceAll('$$', '$') });
	}
	const custom = [...files].map(([name, f]) => {
		try {
			return fromToml(name, f.module ?? '', f.mise ?? '');
		} catch (error) {
			throw new Error(`Custom module ${name}: ${(error as Error).message}`);
		}
	});
	const customNames = new Set(custom.map((m) => m.name));

	const volumes = (Array.isArray(service.volumes) ? service.volumes : []).filter(
		(v): v is string => typeof v === 'string'
	);
	const hostOf = (target: string) =>
		volumes.map((v) => v.split(':')).find((parts) => parts[1] === target)?.[0];

	return {
		...base,
		modules: (env.AGENT_MODULES ?? '')
			.split(/[,\s]+/)
			.filter((m) => m && !customNames.has(m)),
		values: Object.fromEntries(
			Object.entries(env).filter(([k, v]) => !BASE_VARS.has(k) && !/^\$\{[A-Z0-9_]+\}$/.test(v))
		),
		custom,
		service: serviceName,
		imageTag: String(service.image ?? '').split(':').at(-1) || base.imageTag,
		puid: env.PUID || base.puid,
		pgid: env.PGID || base.pgid,
		tz: env.TZ ?? '',
		agentUser,
		dataDir: hostOf(home)?.replace(/\/home$/, '') ?? base.dataDir,
		sshKeys: hostOf(`${home}/.ssh-keys`) ?? '',
		autoUpdate: env.AUTO_UPDATE !== 'false'
	};
}
