import { describe, fromToml } from './module';
import type { Module } from './types';

/** What fitout.toml means when it sets no `catalog`: the catalog folder of the repository on main. */
export const OFFICIAL_CATALOG = 'https://raw.githubusercontent.com/joostme/fitout/main/catalog';

const sources = import.meta.glob('../../../catalog/*.toml', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** The catalog of the repository, built into the page, by module name. */
export const catalog = new Map<string, Module>(
	Object.values(sources)
		.map((source) => describe(fromToml(source)))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((module) => [module.name, module])
);
