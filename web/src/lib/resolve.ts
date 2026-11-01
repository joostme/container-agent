import type { Config, Module } from './types';

export type Source = 'catalog' | 'local';

export interface Resolution {
	/** Enabled modules in setup order, as the entrypoint resolves them. */
	order: Module[];
	source: Map<string, Source>;
	/** Enabled modules -> the enabled modules that require them. */
	requiredBy: Map<string, string[]>;
	/** Modules neither the catalog nor the custom modules have. */
	unknown: string[];
	cycle: string | null;
}

/**
 * Same rules as `fitout`: picked and custom modules are enabled, `requires`
 * enables more; a custom module replaces the catalog module of its name.
 * Then depth-first over `requires`, modules in alphabetical order.
 */
export function resolve(
	config: Pick<Config, 'modules'>,
	catalog: Map<string, Module>,
	custom: Map<string, Module>
): Resolution {
	const enabled = new Map<string, Module>();
	const source = new Map<string, Source>();
	const requiredBy = new Map<string, string[]>();
	const unknown: string[] = [];

	const add = (name: string) => {
		if (enabled.has(name) || unknown.includes(name)) return;
		const module = custom.get(name) ?? catalog.get(name);
		if (!module) {
			unknown.push(name);
			return;
		}
		source.set(name, custom.has(name) ? 'local' : 'catalog');
		enabled.set(name, module);
		for (const dep of module.requires) {
			requiredBy.set(dep, [...(requiredBy.get(dep) ?? []), name]);
			add(dep);
		}
	};
	for (const name of config.modules) add(name);
	for (const name of custom.keys()) add(name);

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
		for (const dep of module.requires) {
			const other = enabled.get(dep);
			if (other) visit(other);
		}
		mark.set(module.name, 'visited');
		order.push(module);
	};
	for (const name of [...enabled.keys()].sort()) visit(enabled.get(name) as Module);

	return { order, source, requiredBy, unknown, cycle };
}
