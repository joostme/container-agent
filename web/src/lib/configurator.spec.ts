import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { describe as suite, expect, it } from 'vitest';
import { compareVersions, versionsFor } from './catalog';
import { defaultConfig, generate } from './generate';
import { describe, emptyModule, fromToml, problems, toToml } from './module';
import { resolve } from './resolve';
import { decodeHash, demoteRequired, encodeConfig, encodeModule, importFiles, review, unpack } from './share';
import { engine, engines, files, index, newest, root } from './test/fixtures';
import type { Config, Doc } from './types';

const inputs = (config: Config) => ({
	index,
	formats: engine.formats,
	files,
	custom: new Map(config.custom.map((doc) => [String(doc.name), describe(doc)]))
});

const configWith = (modules: Record<string, string>, extra: Partial<Config> = {}): Config => ({
	...defaultConfig(engines),
	modules,
	...extra
});

const run = (config: Config) => {
	const resolution = resolve(config, inputs(config));
	const output = generate(config, resolution, index, engine);
	const file = (path: string) => output.files.find((f) => f.path === path)?.text ?? '';
	return { resolution, output, file };
};

const jupyter: Doc = {
	format: 1,
	name: 'jupyter',
	description: 'JupyterLab',
	requires: ['uv'],
	env: { JUPYTER_TOKEN: { type: 'secret', required: true }, JUPYTER_PORT: { type: 'port', protocol: 'http', default: '8888' } },
	mise: {
		tools: { 'pipx:jupyterlab': 'latest' },
		bootstrap: { hooks: { 'post-packages': { run: 'echo root\necho twice' } } }
	},
	daemons: { jupyter: { run: 'exec jupyter lab', retry: true, ready_cmd: 'true' } }
};

/** Setup order the entrypoint computes for an agent.toml. */
function entrypointOrder(agentToml: string, modules: Record<string, string> = {}): string[] {
	const dir = mkdtempSync(join(tmpdir(), 'configurator-'));
	mkdirSync(join(dir, 'modules'));
	const catalog = join(root, 'web/static/catalog');
	writeFileSync(join(dir, 'agent.toml'), agentToml.replace(/^format = 1$/m, `format = 1\ncatalog = "${catalog}"`));
	for (const [name, text] of Object.entries(modules)) writeFileSync(join(dir, 'modules', `${name}.toml`), text);
	const out = execFileSync(join(root, 'image/container-agent'), ['plan'], {
		encoding: 'utf8',
		env: {
			PATH: process.env.PATH,
			HOME: dir,
			CONTAINER_AGENT_CONFIG: dir,
			CONTAINER_AGENT_CACHE: join(dir, 'cache'),
			OPENCODE_SERVER_PASSWORD: 'x',
			JUPYTER_TOKEN: 'x'
		}
	});
	const section = out.split('\n\n')[0].split('\n').slice(1);
	return section.map((line) => line.split(/\s+/)[0]);
}

suite('catalog', () => {
	it('sorts versions newest first', () => {
		expect(['1.2.0', '1.10.0', '1.9.1'].sort(compareVersions)).toEqual(['1.10.0', '1.9.1', '1.2.0']);
	});

	it('offers only versions in a format the image reads', () => {
		expect(versionsFor(index, 'gh', [1])).toContain(newest('gh'));
		expect(versionsFor(index, 'gh', [2])).toEqual([]);
	});
});

suite('resolve', () => {
	it('enables required modules with the newest version and orders them', () => {
		const { resolution } = run(configWith({ t3: newest('t3'), 'claude-remote': newest('claude-remote') }));
		expect(resolution.order.map((m) => m.name)).toEqual(['node', 'claude', 'claude-remote', 't3']);
		expect(resolution.requiredBy.get('claude')).toEqual(['claude-remote']);
		expect(resolution.missing).toEqual([]);
	});

	it('reports files still to load', () => {
		const config = configWith({ gh: newest('gh') });
		const resolution = resolve(config, { ...inputs(config), files: new Map() });
		expect(resolution.missing).toEqual([{ name: 'gh', version: newest('gh') }]);
	});

	it('reports unknown modules and versions', () => {
		const { resolution } = run(configWith({ nope: 'latest', gh: '9.9.9' }));
		expect(resolution.unknown).toEqual(['nope', 'gh 9.9.9']);
	});

	it('takes a custom module before the catalog for requires', () => {
		const custom = { ...emptyModule('uv'), description: 'my uv' };
		const { resolution } = run(configWith({}, { custom: [jupyter, custom] }));
		expect(resolution.source.get('uv')).toEqual({ kind: 'local' });
		expect(resolution.order.map((m) => m.name)).toEqual(['uv', 'jupyter']);
	});

	it('orders like the entrypoint', () => {
		const sets = [
			['t3', 'claude-remote', 'codex', 'opencode'],
			['codex-remote', 'pnpm', 'sshd', 'oh-my-zsh'],
			Object.keys(index.modules)
		];
		for (const names of sets) {
			const { resolution, file } = run(configWith(Object.fromEntries(names.map((n) => [n, newest(n)]))));
			expect(resolution.order.map((m) => m.name)).toEqual(entrypointOrder(file('config/agent.toml')));
		}
		const { resolution, file } = run(configWith({ t3: newest('t3') }, { custom: [jupyter] }));
		expect(resolution.order.map((m) => m.name)).toEqual(
			entrypointOrder(file('config/agent.toml'), { jupyter: toToml(jupyter) })
		);
	}, 60_000);
});

suite('generate', () => {
	it('writes pinned modules, required ones with their reason, values and secrets apart', () => {
		const { file } = run(
			configWith(
				{ 'claude-remote': newest('claude-remote'), opencode: newest('opencode') },
				{ values: { CLAUDE_REMOTE_NAME: 'nas', OPENCODE_SERVER_PASSWORD: 's3cret', OPENCODE_PORT: '4096' }, custom: [jupyter] }
			)
		);
		const agent = file('config/agent.toml');
		const doc = parseToml(agent) as Doc;
		expect(doc.modules).toEqual({
			'claude-remote': newest('claude-remote'),
			opencode: newest('opencode'),
			claude: newest('claude'),
			node: newest('node'),
			uv: newest('uv'),
			jupyter: 'local'
		});
		expect(agent).toContain('# required by claude-remote');
		expect(doc.env).toEqual({ CLAUDE_REMOTE_NAME: 'nas' });
		expect(file('.env')).toContain('OPENCODE_SERVER_PASSWORD=s3cret');
		expect(file('.env')).toContain('JUPYTER_TOKEN=');
		expect(fromToml(file('config/modules/jupyter.toml'))).toEqual(jupyter);
	});

	it('writes compose.yaml with the config folder, ports and .env', () => {
		const { file } = run(configWith({ t3: newest('t3'), 'code-server': newest('code-server') }, { tz: 'Europe/Berlin' }));
		const service = (parseYaml(file('compose.yaml')) as { services: Record<string, Record<string, unknown>> }).services.agent;
		expect(service.image).toBe('ghcr.io/joostme/container-agent:latest');
		expect(service.volumes).toContain('./config:/etc/container-agent:ro');
		expect(service.ports).toEqual(['8080:8080', '3773:3773']);
		expect(service.env_file).toBe('.env');
		expect(service.environment).toEqual({ TZ: 'Europe/Berlin' });
	});

	it('puts everything into compose.yaml when inline', () => {
		const { output, file } = run(configWith({ gh: newest('gh') }, { inline: true, custom: [jupyter] }));
		expect(output.files.map((f) => f.path)).toEqual(['compose.yaml', '.env']);
		const doc = parseYaml(file('compose.yaml')) as { configs: Record<string, { content: string }> };
		expect(Object.keys(doc.configs)).toEqual(['agent-agent-toml', 'agent-modules-jupyter-toml']);
		expect(doc.configs['agent-modules-jupyter-toml'].content).not.toMatch(/[^$]\$[^$]/);
	});

	it('warns about missing values, port clashes and broken custom modules', () => {
		const broken = { format: 1, name: 'Bad', description: 'x', mise: { env: { A: '1' } } };
		const { output } = run(
			configWith({ opencode: newest('opencode'), 'code-server': newest('code-server') }, {
				values: { OPENCODE_PORT: '8080' },
				custom: [broken]
			})
		);
		expect(output.warnings).toEqual(
			expect.arrayContaining([
				'OPENCODE_SERVER_PASSWORD is required by opencode; the container will not start without it.',
				'Port 8080 is used by CODE_SERVER_PORT and OPENCODE_PORT.',
				'Bad: mise.env is not allowed.',
				'Bad: the name may only contain lower-case letters, digits and dashes.'
			])
		);
	});

	it('turns next steps into commands for the service', () => {
		const { output } = run(configWith({ t3: newest('t3') }, { service: 'nas' }));
		expect(output.steps.flatMap((s) => s.parts).filter((p) => p.command).map((p) => p.text)).toContain(
			'docker compose exec nas t3-pair'
		);
	});
});

suite('module', () => {
	it('round-trips catalog files without losing keys', () => {
		for (const name of Object.keys(index.modules)) {
			const doc = files.get(`${name}@${newest(name)}`)?.doc as Doc;
			expect(fromToml(toToml(doc))).toEqual(doc);
			expect(problems(doc)).toEqual([]);
		}
	});

	it('writes scripts as multi-line strings', () => {
		expect(toToml(jupyter)).toContain("run = '''\necho root\necho twice'''");
	});

	it('flags what the entrypoint refuses', () => {
		expect(
			problems({
				format: 2,
				name: 'x',
				description: 'x',
				foo: 1,
				env: { lower: {}, X_C: { type: 'choice' } },
				mise: { bootstrap: { packages: { 'brew:x': 'latest' }, hooks: { 'pre-tools': { run: 'x' } } } }
			})
		).toEqual([
			'format 2; this image reads format 1',
			'unknown field foo',
			'hook pre-tools is not allowed',
			'package brew:x is not an apt package',
			'variable lower must be upper case, e.g. MY_TOKEN',
			'X_C: a choice needs choices'
		]);
	});
});

suite('share', () => {
	it('keeps the settings in the link, without secrets', () => {
		const config = configWith(
			{ opencode: newest('opencode') },
			{ values: { OPENCODE_SERVER_PASSWORD: 'secret', OPENCODE_PORT: '5000' }, custom: [jupyter] }
		);
		const hash = encodeConfig(config, engines, new Set(['OPENCODE_SERVER_PASSWORD']));
		const decoded = decodeHash(`#${hash}`, engines);
		expect(decoded.kind).toBe('config');
		if (decoded.kind !== 'config') return;
		expect(decoded.config).toEqual({ ...config, values: { OPENCODE_PORT: '5000' } });
	});

	it('carries a module in the link and shows what runs as root', () => {
		const hash = encodeModule(jupyter);
		expect(hash.length).toBeLessThan(600);
		const decoded = decodeHash(`#${hash}`, engines);
		expect(decoded.kind).toBe('module');
		if (decoded.kind !== 'module') return;
		const result = review(decoded.source, [1]);
		expect(result.doc).toEqual(jupyter);
		expect(result.root).toEqual([{ what: 'setup hook (post-packages)', run: 'echo root\necho twice' }]);
		expect(result.secrets).toEqual(['JUPYTER_TOKEN']);
		expect(unpack(hash.slice('module='.length))).toBe(toToml(jupyter));
	});

	it('loads its own files again', () => {
		const config = configWith(
			{ 'claude-remote': newest('claude-remote'), opencode: newest('opencode') },
			{
				values: { CLAUDE_REMOTE_NAME: 'nas', OPENCODE_SERVER_PASSWORD: 'secret' },
				custom: [jupyter],
				service: 'box',
				puid: '99',
				pgid: '100',
				tz: 'Europe/Berlin',
				sshKeys: '~/.ssh',
				dataDir: '/mnt/agent',
				workspace: '/work',
				autoUpdate: false
			}
		);
		const { output, resolution } = run(config);
		for (const inline of [false, true]) {
			const files = inline ? run({ ...config, inline }).output.files : output.files;
			const imported = importFiles(files.filter((f) => f.path !== '.env'), engines);
			expect(imported.notes).toEqual([]);
			const settled = demoteRequired(imported.config, resolution);
			expect(settled).toEqual({
				...config,
				inline,
				values: { CLAUDE_REMOTE_NAME: 'nas' },
				pins: { claude: newest('claude'), node: newest('node'), uv: newest('uv') }
			});
		}
	});

	it('asks for the module files agent.toml enables', () => {
		const { output } = run(configWith({}, { custom: [jupyter] }));
		const agent = output.files.filter((f) => f.path === 'config/agent.toml');
		expect(importFiles(agent, engines).notes).toEqual(['agent.toml enables modules/jupyter.toml; load that file too.']);
	});
});

suite('diff', () => {
	it('marks added and removed lines', async () => {
		const { diffLines } = await import('./diff');
		expect(diffLines('a\nb\nc', 'a\nc\nd')).toEqual([
			{ kind: 'same', text: 'a' },
			{ kind: 'remove', text: 'b' },
			{ kind: 'same', text: 'c' },
			{ kind: 'add', text: 'd' }
		]);
	});
});
