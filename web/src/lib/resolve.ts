import type { Module, Registry } from './types';

export interface Resolution {
	/** Enabled modules in setup order, as the entrypoint resolves them. */
	order: Module[];
	/** Modules enabled only because others require them: name -> requiring modules. */
	requiredBy: Map<string, string[]>;
	unknown: string[];
	cycle: string | null;
}

/**
 * Same rules as `container-agent`: `requires` enables modules, `requires` and
 * `after` order them (the latter only among enabled modules), depth-first in
 * the order the modules were picked.
 */
export function resolveModules(registry: Registry, picked: string[]): Resolution {
	const byName = new Map(registry.modules.map((m) => [m.name, m]));
	const enabled = new Map<string, Module>();
	const requiredBy = new Map<string, string[]>();
	const unknown: string[] = [];

	const add = (name: string, by?: string) => {
		const module = byName.get(name);
		if (!module) {
			if (!unknown.includes(name)) unknown.push(name);
			return;
		}
		if (by && !picked.includes(name)) {
			requiredBy.set(name, [...(requiredBy.get(name) ?? []), by]);
		}
		if (enabled.has(name)) return;
		enabled.set(name, module);
		for (const dep of module.requires) add(dep, name);
	};
	for (const name of picked) add(name);

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
	for (const module of enabled.values()) visit(module);

	return { order, requiredBy, unknown, cycle };
}
