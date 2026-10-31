import { key, newestVersion } from './catalog';
import type { CatalogIndex, Config, Module } from './types';

export type Source = { kind: 'catalog'; version: string } | { kind: 'local' };

export interface Resolution {
	/** Enabled modules in setup order, as the entrypoint resolves them. */
	order: Module[];
	source: Map<string, Source>;
	/** Enabled modules -> the enabled modules that require them. */
	requiredBy: Map<string, string[]>;
	/** Catalog files still to load; the resolution is incomplete until they are. */
	missing: { name: string; version: string }[];
	/** Modules or versions neither the catalog nor the custom modules have. */
	unknown: string[];
	cycle: string | null;
}

export interface Inputs {
	index: CatalogIndex;
	formats: number[];
	/** Loaded catalog files by name@version. */
	files: Map<string, Module>;
	/** Custom modules by name. */
	custom: Map<string, Module>;
}

/**
 * Same rules as `container-agent`: picked modules and custom ones ("local")
 * are enabled; `requires` enables more, taking the picked version, a custom
 * module of that name, a pin or the newest compatible version, in that order.
 * Then depth-first over `requires` and `after`, modules in alphabetical order.
 */
export function resolve(config: Pick<Config, 'modules' | 'pins'>, inputs: Inputs): Resolution {
	const { index, formats, files, custom } = inputs;
	const enabled = new Map<string, Module>();
	const source = new Map<string, Source>();
	const requiredBy = new Map<string, string[]>();
	const missing: Resolution['missing'] = [];
	const unknown: string[] = [];

	const specOf = (name: string): string =>
		config.modules[name] ?? (custom.has(name) ? 'local' : (config.pins[name] ?? 'latest'));

	const add = (name: string, spec: string) => {
		if (enabled.has(name) || source.has(name)) return;
		let module: Module | undefined;
		if (spec === 'local') {
			module = custom.get(name);
			if (!module) {
				unknown.push(`${name} (local)`);
				return;
			}
			source.set(name, { kind: 'local' });
		} else {
			const version = spec === 'latest' ? newestVersion(index, name, formats) : spec;
			if (!version || !index.modules[name]?.versions[version]) {
				unknown.push(version ? `${name} ${version}` : name);
				return;
			}
			source.set(name, { kind: 'catalog', version });
			module = files.get(key(name, version));
			if (!module) {
				missing.push({ name, version });
				return;
			}
		}
		enabled.set(name, module);
		for (const dep of module.requires) {
			requiredBy.set(dep, [...(requiredBy.get(dep) ?? []), name]);
			add(dep, specOf(dep));
		}
	};
	for (const [name, spec] of Object.entries(config.modules)) add(name, spec);
	for (const name of custom.keys()) add(name, 'local');

	const order: Module[] = [];
	const mark = new Map<string, 'visiting' | 'visited'>();
	let cycle: string | null = null;
	const visit = (module: Module) => {
		const state = mark.get(module.name);
		if (state === 'visited') return;
		if (state === 'visiting') {
			cycle ??= module.name;
			return;
		}
		mark.set(module.name, 'visiting');
		for (const dep of [...module.requires, ...module.after]) {
			const other = enabled.get(dep);
			if (other) visit(other);
		}
		mark.set(module.name, 'visited');
		order.push(module);
	};
	for (const name of [...enabled.keys()].sort()) visit(enabled.get(name) as Module);

	return { order, source, requiredBy, missing, unknown, cycle };
}
