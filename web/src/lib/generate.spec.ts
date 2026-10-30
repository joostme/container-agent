import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultConfig, generate } from './generate';
import registryJson from './registry.json';
import { decodeHash, encodeHash, importCompose } from './share';
import type { Config, Registry } from './types';

const registry = registryJson as Registry;

function config(overrides: Partial<Config>): Config {
	return { ...defaultConfig(registry), ...overrides };
}

function service(compose: string) {
	return parse(compose).services.agent;
}

describe('generate', () => {
	it('writes the picked modules and the user to compose.yaml', () => {
		const out = generate(config({ modules: ['code-server', 'claude-remote'], puid: '99', pgid: '100' }), registry);
		const svc = service(out.compose);
		expect(svc.image).toBe(`ghcr.io/joostme/container-agent:${registry.version}`);
		expect(svc.environment).toMatchObject({ PUID: '99', PGID: '100', AGENT_MODULES: 'code-server,claude-remote' });
		expect(svc.volumes).toEqual(['./data/home:/home/agent', './data/repos:/repos']);
		expect(svc.ports).toEqual(['8080:8080']);
	});

	it('keeps secrets in .env and references them', () => {
		const out = generate(
			config({ modules: ['code-server'], values: { CODE_SERVER_PASSWORD: 's3cret' } }),
			registry
		);
		expect(service(out.compose).environment.CODE_SERVER_PASSWORD).toBe('${CODE_SERVER_PASSWORD}');
		expect(out.compose).not.toContain('s3cret');
		expect(out.env).toContain('CODE_SERVER_PASSWORD=s3cret');
	});

	it('only writes variables that differ from their default', () => {
		const out = generate(
			config({ modules: ['t3'], values: { T3_PORT: '3773', T3_PUBLIC_URL: 'https://t3.example.org' } }),
			registry
		);
		const env = service(out.compose).environment;
		expect(env).not.toHaveProperty('T3_PORT');
		expect(env.T3_PUBLIC_URL).toBe('https://t3.example.org');
	});

	it('publishes changed ports', () => {
		const out = generate(config({ modules: ['t3'], values: { T3_PORT: '4000' } }), registry);
		expect(service(out.compose).ports).toEqual(['4000:4000']);
	});

	it('mounts SSH keys under the agent user', () => {
		const out = generate(config({ modules: ['gh'], sshKeys: '~/.ssh', agentUser: 'dev' }), registry);
		const svc = service(out.compose);
		expect(svc.volumes).toContain('~/.ssh:/home/dev/.ssh-keys:ro');
		expect(svc.environment.AGENT_USER).toBe('dev');
	});

	it('turns module steps into docker compose exec commands', () => {
		const out = generate(config({ modules: ['claude'] }), registry);
		const commands = out.steps.flatMap((s) => s.parts.filter((p) => p.command).map((p) => p.text));
		expect(commands).toContain('docker compose exec agent agent-run claude');
	});

	it('warns about missing required values and port clashes', () => {
		const out = generate(config({ modules: ['opencode', 't3'], values: { T3_PORT: '4096' } }), registry);
		expect(out.warnings.join('\n')).toMatch(/OPENCODE_SERVER_PASSWORD is required/);
		expect(out.warnings.join('\n')).toMatch(/Port 4096 is used by/);
	});
});

describe('share', () => {
	const cfg = config({
		modules: ['code-server', 't3'],
		values: { CODE_SERVER_PASSWORD: 's3cret', T3_PUBLIC_URL: 'https://t3.example.org' },
		puid: '99'
	});

	it('loads a generated compose.yaml again, without secrets', () => {
		const loaded = importCompose(generate(cfg, registry).compose, registry);
		expect(loaded.modules).toEqual(cfg.modules);
		expect(loaded.puid).toBe('99');
		expect(loaded.values).toEqual({ T3_PUBLIC_URL: 'https://t3.example.org' });
	});

	it('round-trips through the URL hash without secrets', () => {
		const hash = encodeHash(cfg, registry);
		expect(atob(hash.replaceAll('-', '+').replaceAll('_', '/'))).not.toContain('s3cret');
		expect(decodeHash(`#${hash}`, registry)?.values).toEqual({ T3_PUBLIC_URL: 'https://t3.example.org' });
	});

	it('reads every setting from the compose file itself', () => {
		const full = config({
			modules: ['t3', 'gh'],
			values: { T3_PUBLIC_URL: 'https://t3.example.org', GH_TOKEN: 'secret' },
			service: 'dev',
			imageTag: '0.2.0',
			pgid: '100',
			tz: 'Europe/Berlin',
			agentUser: 'me',
			dataDir: '/mnt/agent',
			sshKeys: '~/.ssh',
			autoUpdate: false
		});
		const out = generate(full, registry).compose;
		expect(importCompose(out, registry)).toEqual({ ...full, values: { T3_PUBLIC_URL: 'https://t3.example.org' } });
	});

	it('loads environment written as a list', () => {
		const text = 'services:\n  a:\n    image: x:1.0\n    environment:\n      - AGENT_MODULES=t3,gh\n      - T3_PORT=4000\n';
		const loaded = importCompose(text, registry);
		expect(loaded.modules).toEqual(['t3', 'gh']);
		expect(loaded.values).toEqual({ T3_PORT: '4000' });
		expect(loaded.service).toBe('a');
	});

	it('rejects files from elsewhere', () => {
		expect(() => importCompose('services: {}', registry)).toThrow(/AGENT_MODULES/);
		expect(decodeHash('#not-base64!', registry)).toBeNull();
	});
});
