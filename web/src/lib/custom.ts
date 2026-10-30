import { parse, stringify } from 'smol-toml';
import type { CustomModule, Module } from './types';

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function emptyCustomModule(name: string): CustomModule {
	return {
		name,
		description: '',
		requires: [],
		tools: [],
		packages: '',
		rootSetup: '',
		userSetup: '',
		env: [],
		daemons: [],
		nextSteps: ''
	};
}

const lines = (text: string) =>
	text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

const words = (text: string) => text.split(/\s+/).filter(Boolean);

const usedVars = (module: CustomModule) => module.env.filter((v) => v.name.trim());
const usedDaemons = (module: CustomModule) => module.daemons.filter((d) => d.run.trim());

/** module.toml: metadata, variables and processes, in the format of the built-in modules. */
export function moduleToml(module: CustomModule): string {
	const doc: Record<string, unknown> = { description: module.description || module.name };
	if (module.requires.length) doc.requires = module.requires;
	if (lines(module.nextSteps).length) doc.next_steps = lines(module.nextSteps);
	const env: Record<string, Record<string, unknown>> = {};
	for (const v of usedVars(module)) {
		const spec: Record<string, unknown> = {};
		if (v.description) spec.description = v.description;
		if (v.default) spec.default = v.default;
		if (v.required) spec.required = true;
		if (v.secret) spec.secret = true;
		if (v.port) spec.port = v.port;
		env[v.name.trim()] = spec;
	}
	if (Object.keys(env).length) doc.env = env;
	const daemons: Record<string, Record<string, unknown>> = {};
	for (const d of usedDaemons(module)) {
		const spec: Record<string, unknown> = { run: d.run.trim(), retry: true };
		if (/^\d+$/.test(d.readyPort.trim())) spec.ready_port = Number(d.readyPort.trim());
		daemons[d.name.trim() || module.name] = spec;
	}
	if (Object.keys(daemons).length) doc.daemons = daemons;
	return stringify(doc);
}

/** mise.toml: tools, apt packages and setup commands. */
export function miseToml(module: CustomModule): string {
	const doc: Record<string, unknown> = {};
	const tools = module.tools.filter((t) => t.name.trim());
	if (tools.length) {
		doc.tools = Object.fromEntries(tools.map((t) => [t.name.trim(), t.version.trim() || 'latest']));
	}
	const bootstrap: Record<string, unknown> = {};
	const packages = words(module.packages);
	if (packages.length) bootstrap.packages = Object.fromEntries(packages.map((p) => [`apt:${p}`, 'latest']));
	const hooks: Record<string, unknown> = {};
	if (module.rootSetup.trim()) hooks['post-packages'] = { run: module.rootSetup.trim() };
	if (module.userSetup.trim()) hooks['post-tools'] = { run: module.userSetup.trim() };
	if (Object.keys(hooks).length) bootstrap.hooks = hooks;
	if (Object.keys(bootstrap).length) doc.bootstrap = bootstrap;
	return stringify(doc);
}

/** The custom module as the registry describes modules, so it resolves and shows like the others. */
export function toModule(module: CustomModule): Module {
	const daemons = usedDaemons(module).map((d) => d.name.trim() || module.name);
	return {
		name: module.name,
		kind: daemons.length ? 'service' : 'app',
		description: module.description || module.name,
		requires: module.requires,
		after: [],
		arch: null,
		nextSteps: lines(module.nextSteps),
		env: usedVars(module).map((v) => ({
			name: v.name.trim(),
			description: v.description,
			default: v.default,
			required: v.required,
			secret: v.secret,
			port: v.port || null
		})),
		daemons,
		tools: module.tools.filter((t) => t.name.trim()).map((t) => t.name.trim()),
		packages: words(module.packages),
		commands: []
	};
}

export function customWarnings(modules: CustomModule[], builtIn: string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const module of modules) {
		const label = module.name || 'A custom module';
		if (!NAME_PATTERN.test(module.name)) {
			result.push(`${label}: the name may only contain lower-case letters, digits and dashes.`);
		}
		if (seen.has(module.name)) result.push(`Two custom modules are called ${module.name}.`);
		seen.add(module.name);
		if (builtIn.includes(module.name)) result.push(`Custom module ${module.name} replaces the built-in one.`);
		for (const v of usedVars(module)) {
			if (!VAR_PATTERN.test(v.name.trim())) {
				result.push(`${label}: variable ${v.name} must be upper case, e.g. MY_TOKEN.`);
			}
		}
		for (const d of usedDaemons(module)) {
			if (d.name.trim() && !NAME_PATTERN.test(d.name.trim())) {
				result.push(`${label}: process ${d.name} may only contain lower-case letters, digits and dashes.`);
			}
		}
		for (const t of module.tools) {
			if (/[\s"]/.test(t.name.trim() + t.version.trim())) {
				result.push(`${label}: tool "${t.name}" must not contain spaces or quotes.`);
			}
		}
	}
	return result;
}

type Table = Record<string, unknown>;
const table = (v: unknown): Table => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Table) : {});
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * The editor form of a module from its two files, e.g. read back from
 * compose.yaml. Keys the editor does not know are dropped.
 */
export function fromToml(name: string, moduleText: string, miseText: string): CustomModule {
	const meta = parse(moduleText) as Table;
	const mise = parse(miseText) as Table;
	const bootstrap = table(mise.bootstrap);
	const hooks = table(bootstrap.hooks);
	const description = text(meta.description);
	return {
		...emptyCustomModule(name),
		description: description === name ? '' : description,
		requires: strings(meta.requires),
		tools: Object.entries(table(mise.tools)).map(([tool, version]) => ({
			name: tool,
			version: text(version) === 'latest' ? '' : text(version)
		})),
		packages: Object.keys(table(bootstrap.packages))
			.map((p) => p.replace(/^apt:/, ''))
			.join(' '),
		rootSetup: text(table(hooks['post-packages']).run),
		userSetup: text(table(hooks['post-tools']).run),
		env: Object.entries(table(meta.env)).map(([varName, raw]) => {
			const spec = table(raw);
			return {
				name: varName,
				default: text(spec.default),
				description: text(spec.description),
				secret: spec.secret === true,
				required: spec.required === true,
				port: spec.port === 'http' || spec.port === 'tcp' ? spec.port : ''
			};
		}),
		daemons: Object.entries(table(meta.daemons)).map(([daemon, raw]) => {
			const spec = table(raw);
			return {
				name: daemon === name ? '' : daemon,
				run: text(spec.run),
				readyPort: typeof spec.ready_port === 'number' ? String(spec.ready_port) : ''
			};
		}),
		nextSteps: strings(meta.next_steps).join('\n')
	};
}
