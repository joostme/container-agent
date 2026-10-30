import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { emptyCustomModule } from './custom';
import { CUSTOM_DIR, defaultConfig, generate } from './generate';
import registryJson from './registry.json';
import { importCompose } from './share';
import type { Config, CustomModule, Registry } from './types';

const registry = registryJson as Registry;
const repo = fileURLToPath(new URL('../../..', import.meta.url));

const api: CustomModule = {
	...emptyCustomModule('api'),
	description: 'Java API server',
	requires: ['gh'],
	tools: [
		{ name: 'java', version: '21' },
		{ name: 'maven', version: '' }
	],
	packages: 'ffmpeg  imagemagick',
	rootSetup: 'echo root',
	userSetup: 'echo "user $HOME"',
	env: [
		{ name: 'API_PORT', default: '9000', description: 'Port', secret: false, required: false, port: 'http' },
		{ name: 'API_TOKEN', default: '', description: 'Token', secret: true, required: true, port: '' }
	],
	daemons: [{ name: '', run: 'exec java -jar app.jar --port "$API_PORT"', readyPort: '9000' }],
	nextSteps: 'Open the API\n\n  Log in: `agent-run api-login`  '
};

function config(overrides: Partial<Config>): Config {
	return { ...defaultConfig(registry), ...overrides };
}

/** What the files look like inside the container: compose turns $$ back into $. */
function mountedFiles(compose: string) {
	const doc = parse(compose);
	const service = doc.services.agent;
	return Object.fromEntries(
		service.configs.map((c: { source: string; target: string }) => [
			c.target,
			(doc.configs[c.source].content as string).replaceAll('$$', '$')
		])
	) as Record<string, string>;
}

describe('custom modules', () => {
	const out = generate(config({ custom: [api], values: { API_TOKEN: 's3cret' } }), registry);
	const files = mountedFiles(out.compose);

	it('mounts module.toml and mise.toml into the custom module directory', () => {
		expect(Object.keys(files).sort()).toEqual([`${CUSTOM_DIR}/api/mise.toml`, `${CUSTOM_DIR}/api/module.toml`]);
	});

	it('enables the custom module and what it requires', () => {
		expect(parse(out.compose).services.agent.environment.AGENT_MODULES).toBe('api');
		expect(out.resolution.order.map((m) => m.name)).toEqual(['gh', 'api']);
	});

	it('writes module.toml in the module format', () => {
		const meta = parseToml(files[`${CUSTOM_DIR}/api/module.toml`]);
		expect(meta).toMatchObject({
			description: 'Java API server',
			requires: ['gh'],
			next_steps: ['Open the API', 'Log in: `agent-run api-login`'],
			env: { API_PORT: { default: '9000', port: 'http' }, API_TOKEN: { required: true, secret: true } },
			daemons: { api: { run: 'exec java -jar app.jar --port "$API_PORT"', retry: true, ready_port: 9000 } }
		});
	});

	it('writes mise.toml with tools, apt packages and setup hooks', () => {
		expect(parseToml(files[`${CUSTOM_DIR}/api/mise.toml`])).toEqual({
			tools: { java: '21', maven: 'latest' },
			bootstrap: {
				packages: { 'apt:ffmpeg': 'latest', 'apt:imagemagick': 'latest' },
				hooks: { 'post-packages': { run: 'echo root' }, 'post-tools': { run: 'echo "user $HOME"' } }
			}
		});
	});

	it('escapes $ for compose and keeps secrets in .env', () => {
		expect(out.compose).toContain('$$API_PORT');
		expect(out.compose).not.toContain('s3cret');
		expect(out.env).toContain('API_TOKEN=s3cret');
		expect(parse(out.compose).services.agent.ports).toEqual(['9000:9000']);
	});

	it('runs through the entrypoint like a built-in module', () => {
		const dir = mkdtempSync(join(tmpdir(), 'custom-'));
		try {
			for (const [target, text] of Object.entries(files)) {
				const file = join(dir, target.slice(CUSTOM_DIR.length));
				mkdirSync(join(file, '..'), { recursive: true });
				writeFileSync(file, text);
			}
			const plan = execFileSync(`${repo}image/container-agent`, ['plan'], {
				env: {
					PATH: process.env.PATH,
					HOME: process.env.HOME,
					AGENT_MODULES: 'api',
					API_TOKEN: 'x',
					CONTAINER_AGENT_MODULE_PATH: `${dir}:${repo}modules`
				},
				encoding: 'utf8'
			});
			expect(plan).toMatch(/^gh\s+\S+\/modules\/gh$/m);
			expect(plan).toContain('API_PORT=9000');
			expect(plan).toContain('[daemons.api]');
			expect(plan).toContain('$API_PORT');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('replaces a built-in module of the same name', () => {
		const result = generate(config({ modules: ['t3'], custom: [{ ...emptyCustomModule('t3'), description: 'mine' }] }), registry);
		expect(result.resolution.order.find((m) => m.name === 't3')?.description).toBe('mine');
		expect(result.warnings.join('\n')).toMatch(/replaces the built-in one/);
	});

	it('is an app without processes and a service with one', () => {
		const app = generate(config({ custom: [{ ...api, daemons: [] }] }), registry);
		expect(app.resolution.order.find((m) => m.name === 'api')?.kind).toBe('app');
		expect(out.resolution.order.find((m) => m.name === 'api')?.kind).toBe('service');
	});

	it('warns about invalid names', () => {
		const bad = generate(
			config({ custom: [{ ...emptyCustomModule('My Module'), env: [{ ...api.env[0], name: 'lower' }] }] }),
			registry
		);
		expect(bad.warnings.join('\n')).toMatch(/only contain lower-case/);
		expect(bad.warnings.join('\n')).toMatch(/must be upper case/);
	});

	it('comes back when loading compose.yaml again, without secret values', () => {
		const loaded = importCompose(out.compose, registry);
		expect(loaded.custom).toEqual([
			{ ...api, packages: 'ffmpeg imagemagick', nextSteps: 'Open the API\nLog in: `agent-run api-login`' }
		]);
		expect(loaded.values).toEqual({});
	});

	it('leaves no $ for compose to replace', () => {
		// every $ is either $$ (escaped) or ${SECRET} (from .env)
		expect(out.compose.replaceAll('$$', '').replace(/\$\{[A-Z0-9_]+\}/g, '')).not.toContain('$');
	});

	it('keeps changes made to the module files in compose.yaml by hand', () => {
		const edited = out.compose.replace('java = "21"', 'java = "17"');
		expect(importCompose(edited, registry).custom[0].tools[0]).toEqual({ name: 'java', version: '17' });
	});
});
