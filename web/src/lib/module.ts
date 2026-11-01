import { parse, stringify } from 'smol-toml';
import { VAR_TYPES, type Doc, type EnvVar, type Module, type VarType } from './types';

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/;
/** The module format the image reads (FORMATS in image/fitout). */
export const FORMAT = 1;
export const SCHEMA_URL =
	'https://raw.githubusercontent.com/joostme/fitout/main/schema/v1/module.schema.json';

export const table = (v: unknown): Doc => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {});
export const text = (v: unknown): string =>
	typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
export const strings = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function envVar(name: string, raw: unknown): EnvVar {
	const spec = table(raw);
	const type = VAR_TYPES.includes(spec.type as VarType) ? (spec.type as VarType) : 'string';
	return {
		name,
		type,
		default: text(spec.default),
		required: spec.required === true,
		choices: strings(spec.choices),
		protocol: spec.protocol === 'http' || spec.protocol === 'tcp' ? spec.protocol : null,
		description: text(spec.description)
	};
}

/** The configurator's view of a module file. */
export function describe(doc: Doc): Module {
	const mise = table(doc.mise);
	const hooks = table(table(mise.bootstrap).hooks);
	const daemons = table(doc.daemons);
	const root: Module['root'] = [];
	const rootHook = text(table(hooks['post-packages']).run);
	if (rootHook) root.push({ what: 'setup hook (post-packages)', run: rootHook });
	for (const [name, raw] of Object.entries(daemons)) {
		if (table(raw).user === 'root') root.push({ what: `daemon ${name}`, run: text(table(raw).run) });
	}
	return {
		name: text(doc.name),
		kind: Object.keys(daemons).length ? 'service' : 'app',
		description: text(doc.description),
		version: text(doc.version),
		format: typeof doc.format === 'number' ? doc.format : null,
		homepage: text(doc.homepage) || null,
		tags: strings(doc.tags),
		requires: strings(doc.requires),
		nextSteps: strings(doc.next_steps),
		env: Object.entries(table(doc.env)).map(([name, raw]) => envVar(name, raw)),
		commands: Object.keys(table(mise.tasks)),
		daemons: Object.keys(daemons),
		root,
		doc
	};
}

const unknown = (doc: Doc, allowed: string[]) => Object.keys(doc).filter((k) => !allowed.includes(k));

/**
 * What the entrypoint would refuse, so the configurator says it first. Same
 * rules as validate_module in image/fitout, plus the form checks.
 */
export function problems(doc: Doc): string[] {
	const result: string[] = [];
	const name = text(doc.name);
	if (doc.format !== FORMAT) {
		result.push(`format ${text(doc.format) || 'missing'}; the image reads format ${FORMAT}`);
	}
	if (!NAME_PATTERN.test(name)) result.push('the name may only contain lower-case letters, digits and dashes');
	if (!text(doc.description)) result.push('description missing');
	for (const key of unknown(doc, [
		'format', 'name', 'description', 'version', 'tags', 'author', 'homepage',
		'requires', 'next_steps', 'env', 'mise', 'daemons'
	])) {
		result.push(`unknown field ${key}`);
	}
	const mise = table(doc.mise);
	for (const key of unknown(mise, ['tools', 'tasks', 'bootstrap'])) result.push(`mise.${key} is not allowed`);
	const bootstrap = table(mise.bootstrap);
	for (const key of unknown(bootstrap, ['packages', 'hooks'])) result.push(`mise.bootstrap.${key} is not allowed`);
	for (const key of unknown(table(bootstrap.hooks), ['post-packages', 'post-tools'])) {
		result.push(`hook ${key} is not allowed`);
	}
	for (const key of Object.keys(table(bootstrap.packages))) {
		if (!key.startsWith('apt:')) result.push(`package ${key} is not an apt package`);
	}
	for (const [variable, raw] of Object.entries(table(doc.env))) {
		const spec = table(raw);
		if (!VAR_PATTERN.test(variable)) result.push(`variable ${variable} must be upper case, e.g. MY_TOKEN`);
		for (const key of unknown(spec, ['type', 'default', 'required', 'choices', 'protocol', 'description'])) {
			result.push(`${variable}: unknown field ${key}`);
		}
		if (spec.type !== undefined && !VAR_TYPES.includes(spec.type as VarType)) {
			result.push(`${variable}: unknown type ${text(spec.type)}`);
		}
		if (spec.type === 'choice' && !strings(spec.choices).length) result.push(`${variable}: a choice needs choices`);
		if (spec.protocol !== undefined && spec.type !== 'port') result.push(`${variable}: protocol is only for ports`);
	}
	for (const daemon of Object.keys(table(doc.daemons))) {
		if (!NAME_PATTERN.test(daemon)) result.push(`daemon ${daemon} may only contain lower-case letters, digits and dashes`);
		if (!text(table(table(doc.daemons)[daemon]).run)) result.push(`daemon ${daemon} has no run command`);
	}
	return result;
}

export function emptyModule(name: string): Doc {
	return { format: FORMAT, name, description: '' };
}

/** Drops empty tables and values the forms leave behind. */
function prune(value: unknown): unknown {
	if (Array.isArray(value)) return value;
	if (value && typeof value === 'object') {
		const out: Doc = {};
		for (const [key, inner] of Object.entries(value)) {
			const pruned = prune(inner);
			if (pruned === undefined || pruned === '') continue;
			if (pruned && typeof pruned === 'object' && !Array.isArray(pruned) && !Object.keys(pruned).length) continue;
			out[key] = pruned;
		}
		return out;
	}
	return value;
}

const FIELD_ORDER = [
	'format', 'name', 'description', 'version', 'tags', 'author', 'homepage',
	'requires', 'next_steps', 'env', 'mise', 'daemons'
];

/** The module file, with the schema line editors use. */
export function toToml(doc: Doc): string {
	const pruned = prune(JSON.parse(JSON.stringify(doc))) as Doc;
	const ordered: Doc = {};
	for (const key of FIELD_ORDER) if (key in pruned) ordered[key] = pruned[key];
	for (const key of Object.keys(pruned)) if (!(key in ordered)) ordered[key] = pruned[key];
	return `#:schema ${SCHEMA_URL}\n${multiline(stringify(ordered))}\n`;
}

/** Scripts as multi-line literal strings instead of one line full of \n. */
function multiline(source: string): string {
	return source.replace(/^([A-Za-z0-9_"'.:@-]+ = )("(?:[^"\\]|\\.)*\\n(?:[^"\\]|\\.)*")$/gm, (line, key, quoted) => {
		let value: string;
		try {
			value = JSON.parse(quoted);
		} catch {
			return line;
		}
		// eslint-disable-next-line no-control-regex
		if (value.includes("'''") || value.endsWith("'") || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) {
			return line;
		}
		return `${key}'''\n${value}'''`;
	});
}

export function fromToml(source: string): Doc {
	return parse(source) as Doc;
}
