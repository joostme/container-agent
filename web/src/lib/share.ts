import { parse } from 'yaml';
import { defaultConfig, SETTINGS_KEY, storedSettings } from './generate';
import type { Config, Registry } from './types';

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

/** Settings from a compose.yaml this configurator generated. */
export function importCompose(text: string, registry: Registry): Config {
	let doc: unknown;
	try {
		doc = parse(text);
	} catch (error) {
		throw new Error(`Not valid YAML: ${(error as Error).message}`);
	}
	const settings = (doc as Record<string, unknown> | null)?.[SETTINGS_KEY];
	if (!settings) {
		throw new Error(`No ${SETTINGS_KEY} block found; only files from this configurator can be loaded.`);
	}
	return normalize(settings, registry);
}
