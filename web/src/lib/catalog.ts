import { describe, fromToml } from './module';
import type { CatalogIndex, Module } from './types';

/** The official catalog, as agent.toml names it when `catalog` is not set. */
export const OFFICIAL_CATALOG = 'https://joostme.github.io/container-agent/catalog';

/** Highest first, by semver. */
export function compareVersions(a: string, b: string): number {
	const parts = (v: string) => v.split('.').map((p) => Number.parseInt(p, 10) || 0);
	const [x, y] = [parts(a), parts(b)];
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
	}
	return 0;
}

/** Versions of a module an image with these formats reads, newest first. */
export function versionsFor(index: CatalogIndex, name: string, formats: number[]): string[] {
	return Object.entries(index.modules[name]?.versions ?? {})
		.filter(([, v]) => formats.includes(v.format))
		.map(([version]) => version)
		.sort(compareVersions);
}

export function newestVersion(index: CatalogIndex, name: string, formats: number[]): string | null {
	return versionsFor(index, name, formats)[0] ?? null;
}

export const key = (name: string, version: string) => `${name}@${version}`;

/** null where the browser has no WebCrypto (plain http on a LAN address). */
async function sha256(source: string): Promise<string | null> {
	if (!globalThis.crypto?.subtle) return null;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reads index.json and module files of a catalog, checked like the entrypoint does. */
export class Catalog {
	readonly base: string;
	readonly sources = new Map<string, string>();

	constructor(base: string) {
		this.base = base.replace(/\/$/, '');
	}

	async index(): Promise<CatalogIndex> {
		const response = await fetch(`${this.base}/index.json`);
		if (!response.ok) throw new Error(`${this.base}/index.json: ${response.status} ${response.statusText}`);
		const index = (await response.json()) as CatalogIndex;
		if (!index || typeof index.modules !== 'object') throw new Error(`${this.base}/index.json is not a catalog index`);
		return index;
	}

	/** The file of a module version; throws if it does not match the index. */
	async module(index: CatalogIndex, name: string, version: string): Promise<Module> {
		const expected = index.modules[name]?.versions[version]?.sha256;
		if (!expected) throw new Error(`${name} ${version} is not in the catalog`);
		const response = await fetch(`${this.base}/${name}/${version}.toml`);
		if (!response.ok) throw new Error(`${name} ${version}: ${response.status} ${response.statusText}`);
		const source = await response.text();
		const actual = await sha256(source);
		if (actual !== null && actual !== expected) {
			throw new Error(`${name} ${version} does not match the checksum in the catalog index`);
		}
		this.sources.set(key(name, version), source);
		return describe(fromToml(source));
	}
}
