// Builds registry.json from ../modules: everything a configurator needs to
// know about the modules of one image version.
//
//   node scripts/build-registry.js [output]   default: src/lib/registry.json
//
// IMAGE_VERSION sets the image tag the registry belongs to (default: latest).
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const modulesDir = join(root, 'modules');
const output = resolve(process.argv[2] ?? join(root, 'web/src/lib/registry.json'));

function readToml(file) {
	return existsSync(file) ? parse(readFileSync(file, 'utf8')) : {};
}

function readModule(name) {
	const dir = join(modulesDir, name);
	const meta = readToml(join(dir, 'module.toml'));
	const mise = readToml(join(dir, 'mise.toml'));
	const bin = join(dir, 'bin');
	const daemons = Object.keys(meta.daemons ?? {});
	return {
		name,
		// services run a process, apps only install and set up
		kind: daemons.length > 0 ? 'service' : 'app',
		description: meta.description,
		requires: meta.requires ?? [],
		after: meta.after ?? [],
		arch: meta.arch ?? null,
		nextSteps: meta.next_steps ?? [],
		env: Object.entries(meta.env ?? {}).map(([varName, spec]) => ({
			name: varName,
			description: spec.description ?? '',
			default: spec.default ?? '',
			required: spec.required ?? false,
			secret: spec.secret ?? false,
			port: spec.port ?? null
		})),
		daemons,
		tools: Object.keys(mise.tools ?? {}),
		packages: Object.keys(mise.bootstrap?.packages ?? {}).map((p) => p.replace(/^apt:/, '')),
		commands: existsSync(bin) ? readdirSync(bin).sort() : []
	};
}

const modules = readdirSync(modulesDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(modulesDir, entry.name, 'module.toml')))
	.map((entry) => readModule(entry.name))
	.sort((a, b) => a.name.localeCompare(b.name));

const registry = {
	image: 'ghcr.io/joostme/container-agent',
	version: process.env.IMAGE_VERSION || 'latest',
	modules
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(registry, null, '\t')}\n`);
console.log(`${output}: ${modules.length} modules, version ${registry.version}`);
