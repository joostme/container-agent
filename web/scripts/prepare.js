// Generated inputs of the configurator, rebuilt before dev, build, check and test:
//
//   src/lib/mise-tools.json    tools of the mise registry, suggested in the editor
//                              (empty if mise is not installed)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(root, 'web');
const run = (cmd, args, options = {}) =>
	execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });

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
