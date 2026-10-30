import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import registryJson from './registry.json';
import { resolveModules } from './resolve';
import type { Registry } from './types';

const registry = registryJson as Registry;
const repo = fileURLToPath(new URL('../../..', import.meta.url));

/** Module order of the real entrypoint, so both resolve alike. */
function entrypointOrder(modules: string): string[] {
	const out = execFileSync(`${repo}image/container-agent`, ['plan'], {
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			AGENT_MODULES: modules,
			CONTAINER_AGENT_MODULE_PATH: `${repo}modules`,
			OPENCODE_SERVER_PASSWORD: 'x'
		},
		encoding: 'utf8'
	});
	const section = out.split('\n\n')[0].split('\n').slice(1);
	return section.filter(Boolean).map((line) => line.split(/\s+/)[0]);
}

describe('resolveModules', () => {
	const cases = [
		['t3', 'claude-remote'],
		['t3', 'codex-remote', 'opencode'],
		['code-server', 'sshd', 'oh-my-zsh', 'gh'],
		['claude-remote', 'codex-remote', 't3', 'code-server'],
		registry.modules.map((m) => m.name)
	];
	it.each(cases)('orders %s like the entrypoint', (...picked) => {
		const order = resolveModules(registry, picked).order.map((m) => m.name);
		expect(order).toEqual(entrypointOrder(picked.join(',')));
	});

	it('records which modules pulled in a required one', () => {
		const { requiredBy } = resolveModules(registry, ['claude-remote']);
		expect(requiredBy.get('claude')).toEqual(['claude-remote']);
	});

	it('does not mark picked modules as required', () => {
		const { requiredBy } = resolveModules(registry, ['claude', 'claude-remote']);
		expect(requiredBy.has('claude')).toBe(false);
	});

	it('reports unknown modules', () => {
		expect(resolveModules(registry, ['nope']).unknown).toEqual(['nope']);
	});
});
