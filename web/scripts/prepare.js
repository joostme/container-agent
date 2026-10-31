// Generated inputs of the configurator, rebuilt before dev, build, check and test:
//
//   static/catalog/            the catalog with every version from the git
//                              history (scripts/build-catalog --history), served
//                              next to the page like on GitHub Pages
//   src/lib/engines.json       image versions and the module formats they read,
//                              from the v* tags plus "latest" (main)
//   src/lib/mise-tools.json    tools of the mise registry, suggested in the editor
//                              (empty if mise is not installed)
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(root, 'web');
const run = (cmd, args, options = {}) =>
	execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });

// catalog
const catalog = join(web, 'static/catalog');
rmSync(catalog, { recursive: true, force: true });
const history = (() => {
	try {
		run('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
		return ['--history'];
	} catch {
		return [];
	}
})();
console.log(run(join(root, 'scripts/build-catalog'), [...history, catalog], { stdio: ['ignore', 'pipe', 'inherit'] }).trim());

// engines: FORMATS="1 2" in the entrypoint of each tag; older tags have none
const formatsOf = (text) => {
	const match = text.match(/^FORMATS="([\d ]+)"/m);
	return match ? match[1].split(' ').filter(Boolean).map(Number) : null;
};
const engines = [];
let tags = [];
try {
	tags = run('git', ['tag', '-l', 'v*', '--sort=-v:refname']).split('\n').filter(Boolean);
} catch {
	// no git: only latest
}
for (const tag of tags) {
	let formats = null;
	try {
		formats = formatsOf(run('git', ['show', `${tag}:image/container-agent`], { stdio: ['ignore', 'pipe', 'ignore'] }));
	} catch {
		// no entrypoint in that tag
	}
	if (formats) engines.push({ image: tag.replace(/^v/, ''), formats });
}
engines.push({ image: 'latest', formats: formatsOf(readFileSync(join(root, 'image/container-agent'), 'utf8')) ?? [] });
writeFileSync(join(web, 'src/lib/engines.json'), `${JSON.stringify(engines, null, '\t')}\n`);
console.log(`engines: ${engines.map((e) => `${e.image} (format ${e.formats.join(', ')})`).join(', ')}`);

// mise registry
let tools = [];
try {
	tools = JSON.parse(run('mise', ['registry', '--hide-aliased', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] })).map(
		(t) => ({ name: t.short, description: t.description ?? '' })
	);
} catch (error) {
	console.warn(`mise registry not available, no tool suggestions: ${error.message.split('\n')[0]}`);
}
writeFileSync(join(web, 'src/lib/mise-tools.json'), `${JSON.stringify(tools)}\n`);
console.log(`mise tools: ${tools.length}`);
