// The catalog built by scripts/prepare.js, read from disk instead of fetched
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { key, newestVersion } from '../catalog';
import { describe, fromToml } from '../module';
import type { CatalogIndex, Engine, Module } from '../types';

export const root = resolvePath(import.meta.dirname, '../../../..');
const dir = join(root, 'web/static/catalog');

export const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as CatalogIndex;
export const engine: Engine = { image: 'latest', formats: [1] };
export const engines: Engine[] = [engine];

export const source = (name: string, version: string) => readFileSync(join(dir, name, `${version}.toml`), 'utf8');

/** Every version of every module, as the page would load them. */
export const files = new Map<string, Module>(
	Object.entries(index.modules).flatMap(([name, entry]) =>
		Object.keys(entry.versions).map((version) => [key(name, version), describe(fromToml(source(name, version)))])
	)
);

export const newest = (name: string) => newestVersion(index, name, [1]) as string;
