<script lang="ts">
	import { onMount } from 'svelte';
	import ModuleCard from '#lib/components/ModuleCard.svelte';
	import ModuleEditor from '#lib/components/ModuleEditor.svelte';
	import OutputPanel from '#lib/components/OutputPanel.svelte';
	import VarField from '#lib/components/VarField.svelte';
	import { catalog } from '#lib/catalog.js';
	import { customModules, defaultConfig, generate, usesSshKeys } from '#lib/generate.js';
	import miseTools from '#lib/mise-tools.json';
	import { emptyModule, text } from '#lib/module.js';
	import { resolve } from '#lib/resolve.js';
	import { decodeHash, encodeConfig, encodeModule, importFiles, review, type Review } from '#lib/share.js';
	import type { Config } from '#lib/types.js';

	const repo = 'https://github.com/joostme/fitout';

	let config = $state<Config>(defaultConfig());
	/** Bumped when config is replaced as a whole, so editors start fresh. */
	let generation = $state(0);
	let ready = $state(false);

	const custom = $derived(new Map(customModules(config).map((m) => [m.name, m])));
	const resolution = $derived(resolve(config, catalog, custom));
	const output = $derived(generate(config, resolution, catalog));
	const configurable = $derived(resolution.order.filter((m) => m.env.length > 0));

	// --- catalog view --------------------------------------------------------------------
	let search = $state('');
	let activeTags = $state<string[]>([]);
	const allTags = [...new Set([...catalog.values()].flatMap((m) => m.tags))].sort((a, b) => a.localeCompare(b));
	const visible = $derived(
		[...catalog.values()].filter((module) => {
			const words = `${module.name} ${module.description} ${module.tags.join(' ')}`.toLowerCase();
			return (
				resolution.source.has(module.name) ||
				((!search || words.includes(search.toLowerCase())) && activeTags.every((t) => module.tags.includes(t)))
			);
		})
	);
	const groups = $derived(
		[
			{ title: 'Services', hint: 'Run a process: remote control, web UIs, servers', kind: 'service' },
			{ title: 'Apps', hint: 'Install and set up: CLIs, agents, runtimes, shells', kind: 'app' }
		].map((g) => ({ ...g, modules: visible.filter((m) => m.kind === g.kind) }))
	);

	function toggle(name: string) {
		config.modules = config.modules.includes(name)
			? config.modules.filter((n) => n !== name)
			: [...config.modules, name].sort();
	}

	// --- custom modules -------------------------------------------------------------------
	function addCustom() {
		const taken = new Set([...catalog.keys(), ...config.custom.map((m) => text(m.name))]);
		let n = 1;
		while (taken.has(`custom-${n}`)) n++;
		config.custom = [...config.custom, emptyModule(`custom-${n}`)];
	}

	async function shareModule(i: number) {
		const url = `${location.origin}${location.pathname}#${encodeModule($state.snapshot(config.custom[i]))}`;
		await navigator.clipboard.writeText(url);
	}

	// --- links ------------------------------------------------------------------------------
	let shared = $state<{ source: string; review: Review } | null>(null);
	let reviewDialog: HTMLDialogElement;
	let linkCopied = $state(false);

	const secrets = $derived(
		new Set(
			[...catalog.values(), ...custom.values()].flatMap((m) =>
				m.env.filter((v) => v.type === 'secret').map((v) => v.name)
			)
		)
	);

	function loadHash() {
		const hash = decodeHash(location.hash);
		if (hash.kind === 'config') {
			config = hash.config;
			generation++;
		} else if (hash.kind === 'module') {
			try {
				shared = { source: hash.source, review: review(hash.source) };
				reviewDialog.showModal();
			} catch (error) {
				importError = `The module in the link is not valid TOML: ${(error as Error).message}`;
			}
		}
	}

	onMount(() => {
		loadHash();
		ready = true;
		// a pasted link in the same tab only changes the hash
		window.addEventListener('hashchange', loadHash);
		return () => window.removeEventListener('hashchange', loadHash);
	});

	// Keep the link in the address bar current (without secrets), unless it shows a module
	$effect(() => {
		const hash = encodeConfig($state.snapshot(config) as Config, secrets);
		if (ready && !shared) history.replaceState(history.state, '', `#${hash}`);
	});

	function closeReview(add: boolean) {
		if (add && shared) {
			const doc = shared.review.doc;
			const existing = config.custom.findIndex((m) => text(m.name) === text(doc.name));
			config.custom = existing >= 0 ? config.custom.map((m, i) => (i === existing ? doc : m)) : [...config.custom, doc];
			generation++;
		}
		shared = null;
		reviewDialog.close();
	}

	async function copyLink() {
		await navigator.clipboard.writeText(location.href);
		linkCopied = true;
		setTimeout(() => (linkCopied = false), 1500);
	}

	// --- loading files --------------------------------------------------------------------------
	let importDialog: HTMLDialogElement;
	let importText = $state('');
	let importFilesList = $state<{ path: string; text: string }[]>([]);
	let importError = $state('');
	let importNotes = $state<string[]>([]);

	function openImport() {
		importError = '';
		importDialog.showModal();
	}

	async function pickFiles(event: Event) {
		const list = (event.currentTarget as HTMLInputElement).files ?? [];
		importFilesList = await Promise.all([...list].map(async (f) => ({ path: f.webkitRelativePath || f.name, text: await f.text() })));
	}

	function applyImport() {
		try {
			const input = [...importFilesList];
			if (importText.trim()) {
				const yaml = /^\s*services\s*:/m.test(importText);
				input.push({ path: yaml ? 'compose.yaml' : 'pasted.toml', text: importText });
			}
			const imported = importFiles(input, catalog);
			config = imported.config;
			importNotes = imported.notes;
			generation++;
			importDialog.close();
			importText = '';
			importFilesList = [];
		} catch (error) {
			importError = (error as Error).message;
		}
	}

	function reset() {
		config = defaultConfig();
		importNotes = [];
		generation++;
	}
</script>

<header>
	<div class="title">
		<h1>fitout <span>configurator</span></h1>
		<p>
			Fit out a plain container: pick tools, apps and services from the catalog or write your own, fill in their
			settings and get <code>fitout.toml</code> and <code>compose.yaml</code> for <a href={repo}>fitout</a>.
		</p>
	</div>
	<div class="header-actions">
		<button onclick={openImport}>Load files</button>
		<button onclick={copyLink} title="Secrets are not part of the link">{linkCopied ? 'Link copied' : 'Copy link'}</button>
		<button onclick={reset}>Reset</button>
	</div>
</header>

<main>
	<div class="config">
		{#if importNotes.length}
			<ul class="notes">
				{#each importNotes as note (note)}<li>{note}</li>{/each}
			</ul>
		{/if}

		<section>
			<h2><span>1</span> Modules</h2>
			<div class="filter">
				<input type="search" bind:value={search} placeholder="Search modules" aria-label="Search modules" />
				<div class="chips">
					{#each allTags as tag (tag)}
						<button
							class="chip"
							aria-pressed={activeTags.includes(tag)}
							onclick={() =>
								(activeTags = activeTags.includes(tag) ? activeTags.filter((t) => t !== tag) : [...activeTags, tag])}
							>{tag}</button
						>
					{/each}
				</div>
			</div>
			{#each groups as group (group.kind)}
				{#if group.modules.length}
					<h3>{group.title} <span>{group.hint}</span></h3>
					<div class="cards">
						{#each group.modules as module (module.name)}
							<ModuleCard
								{module}
								picked={config.modules.includes(module.name)}
								requiredBy={resolution.source.has(module.name) && !config.modules.includes(module.name)
									? (resolution.requiredBy.get(module.name) ?? [])
									: []}
								replaced={custom.has(module.name)}
								onToggle={() => toggle(module.name)}
							/>
						{/each}
					</div>
				{/if}
			{/each}
			{#if !visible.length}
				<p class="empty">No module matches.</p>
			{/if}
		</section>

		<section>
			<h2><span>2</span> Custom modules</h2>
			<p class="empty">
				Anything the catalog does not cover, in the same format: tools from the
				<a href="https://mise.jdx.dev/registry.html">mise registry</a> or a backend such as <code>npm:</code> or
				<code>pipx:</code>, apt packages, setup, commands and processes. They go to <code>config/modules/</code>, are
				always enabled and replace a catalog module of the same name. <em>Share link</em> gives others a link that
				carries the module.
			</p>
			<datalist id="mise-tools">
				{#each miseTools as tool (tool.name)}
					<option value={tool.name}>{tool.description}</option>
				{/each}
			</datalist>
			{#key generation}
				{#each config.custom as _, i (i)}
					<ModuleEditor
						bind:doc={config.custom[i]}
						others={[...catalog.keys(), ...config.custom.map((m) => text(m.name))]
							.filter((n, j, all) => n && n !== text(config.custom[i].name) && all.indexOf(n) === j)
							.sort()}
						onRemove={() => {
							config.custom = config.custom.filter((_, j) => j !== i);
							generation++;
						}}
						onShare={() => shareModule(i)}
					/>
				{/each}
			{/key}
			<button onclick={addCustom}>New custom module</button>
		</section>

		<section>
			<h2><span>3</span> Settings</h2>
			{#if configurable.length === 0}
				<p class="empty">The enabled modules have no settings.</p>
			{/if}
			{#each configurable as module (module.name)}
				<fieldset>
					<legend><code>{module.name}</code></legend>
					<div class="grid">
						{#each module.env as variable (variable.name)}
							<VarField {variable} bind:value={config.values[variable.name]} />
						{/each}
					</div>
				</fieldset>
			{/each}
		</section>

		<section>
			<h2><span>4</span> Container</h2>
			<div class="grid">
				<div class="field">
					<label for="image">Image tag</label>
					<input id="image" bind:value={config.image} spellcheck="false" />
					<small><code>latest</code> follows main, or a release such as <code>0.3</code>.</small>
				</div>
				<div class="field">
					<label for="service">Service and host name</label>
					<input id="service" bind:value={config.service} />
					<small>Also the name Codex Remote Control shows.</small>
				</div>
				<div class="field">
					<label for="puid">PUID</label>
					<input id="puid" bind:value={config.puid} inputmode="numeric" />
					<small>Owner of the data on the host, see <code>id -u</code>.</small>
				</div>
				<div class="field">
					<label for="pgid">PGID</label>
					<input id="pgid" bind:value={config.pgid} inputmode="numeric" />
					<small>See <code>id -g</code>.</small>
				</div>
				<div class="field">
					<label for="data">Data directory on the host</label>
					<input id="data" bind:value={config.dataDir} />
					<small>Holds <code>home</code> (logins, tools) and <code>workspace</code> (your projects or data).</small>
				</div>
				{#if usesSshKeys(resolution.order)}
					<div class="field">
						<label for="ssh">SSH keys on the host</label>
						<input id="ssh" bind:value={config.sshKeys} placeholder="e.g. ~/.ssh, empty for none" />
						<small>Mounted read-only; the ssh module copies them into <code>~/.ssh</code>.</small>
					</div>
				{/if}
				<div class="field">
					<label for="tz">Time zone</label>
					<input id="tz" bind:value={config.tz} placeholder="e.g. Europe/Berlin" />
				</div>
				<div class="field">
					<label for="catalog">Catalog</label>
					<input id="catalog" bind:value={config.catalog} placeholder="official, on main" spellcheck="false" />
					<small>Folder with the module files. To stay on one state, use the official one with a tag or commit instead of <code>main</code>.</small>
				</div>
				<label class="check">
					<input type="checkbox" bind:checked={config.inline} />
					Everything in compose.yaml (<code>configs:</code>, Docker Compose 2.23 or later)
				</label>
			</div>
		</section>
	</div>

	<aside>
		{#if output.warnings.length}
			<ul class="warnings" aria-live="polite">
				{#each output.warnings as warning (warning)}<li>{warning}</li>{/each}
			</ul>
		{/if}
		<OutputPanel {output} folder={config.service || 'fitout'} />
	</aside>
</main>

<dialog bind:this={importDialog}>
	<form method="dialog" onsubmit={(e) => (e.preventDefault(), applyImport())}>
		<h2>Load files</h2>
		<p>
			Pick or paste what the configurator wrote: <code>compose.yaml</code>, <code>fitout.toml</code> and module files,
			in any combination. Secrets live in <code>.env</code>; enter them again.
		</p>
		<input type="file" accept=".yaml,.yml,.toml" multiple onchange={pickFiles} />
		{#if importFilesList.length}<small>{importFilesList.map((f) => f.path).join(', ')}</small>{/if}
		<textarea bind:value={importText} rows="12" spellcheck="false" placeholder="or paste one file here"></textarea>
		{#if importError}<p class="error">{importError}</p>{/if}
		<div class="dialog-actions">
			<button type="button" onclick={() => importDialog.close()}>Cancel</button>
			<button class="primary" type="submit">Load</button>
		</div>
	</form>
</dialog>

<dialog bind:this={reviewDialog} oncancel={() => closeReview(false)}>
	{#if shared}
		{@const doc = shared.review.doc}
		<div class="review">
			<h2>Module from a link: <code>{text(doc.name)}</code></h2>
			<p class="warning">
				This module comes from whoever made the link, not from the reviewed catalog. It runs code in your container;
				add it only if you trust the source and understand what it does.
			</p>
			<p>{text(doc.description)}</p>
			{#if shared.review.problems.length}
				<p class="error">The image would refuse it: {shared.review.problems.join('; ')}.</p>
			{/if}
			<h3>Runs as root</h3>
			{#if shared.review.root.length}
				{#each shared.review.root as part (part.what)}
					<p><strong>{part.what}</strong></p>
					<pre><code>{part.run}</code></pre>
				{/each}
			{:else}
				<p class="empty">Nothing; everything runs as the user.</p>
			{/if}
			<h3>Secrets it reads</h3>
			<p class="empty">{shared.review.secrets.length ? shared.review.secrets.join(', ') : 'None declared.'}</p>
			<h3>The whole file</h3>
			<pre><code>{shared.source}</code></pre>
			<div class="dialog-actions">
				<button type="button" onclick={() => closeReview(false)}>Cancel</button>
				<button type="button" class="primary" onclick={() => closeReview(true)}>
					{config.custom.some((m) => text(m.name) === text(doc.name)) ? 'Replace my module' : 'Add as custom module'}
				</button>
			</div>
		</div>
	{/if}
</dialog>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		padding: 1.4rem clamp(1rem, 3vw, 2.5rem) 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	h1 span {
		color: var(--muted);
		font-weight: 400;
	}
	header p {
		margin: 0.3rem 0 0;
		color: var(--muted);
	}
	.header-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 2rem;
		padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 3rem;
		max-width: 1700px;
		margin: 0 auto;
	}
	@media (max-width: 1100px) {
		main {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	aside {
		position: sticky;
		top: 1rem;
		align-self: start;
		display: grid;
		gap: 0.7rem;
	}
	section {
		margin-bottom: 2rem;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.8rem;
		font-size: 1.15rem;
	}
	h2 span {
		display: inline-grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--accent);
		color: #fff;
		font-size: 0.85rem;
	}
	h3 {
		margin: 1rem 0 0.5rem;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	h3 span {
		margin-left: 0.4rem;
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
	}
	.filter {
		display: grid;
		gap: 0.5rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		padding: 0.1rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
	}
	.chip[aria-pressed='true'] {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 0.6rem;
	}
	fieldset {
		margin: 0 0 0.8rem;
		padding: 0.8rem 1rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}
	legend {
		padding: 0 0.3rem;
		font-weight: 600;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.9rem;
	}
	.field {
		display: grid;
		gap: 0.25rem;
		align-content: start;
	}
	.field small,
	.empty {
		color: var(--muted);
		font-size: 0.88rem;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.check input {
		accent-color: var(--accent);
	}
	.warnings,
	.notes {
		margin: 0 0 0.7rem;
		padding: 0.6rem 0.8rem 0.6rem 1.8rem;
		border: 1px solid var(--warn-border);
		border-radius: var(--radius);
		background: var(--warn-bg);
		color: var(--warn);
		font-size: 0.88rem;
	}
	dialog {
		width: min(760px, 94vw);
		max-height: 90vh;
		padding: 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.45);
	}
	dialog form,
	.review {
		display: grid;
		gap: 0.7rem;
	}
	dialog h2 {
		margin: 0;
	}
	dialog h3 {
		margin: 0.4rem 0 0;
	}
	dialog p {
		margin: 0;
	}
	dialog pre {
		margin: 0;
		padding: 0.7rem;
		max-height: 40vh;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-2);
		font-size: 0.8rem;
	}
	.warning {
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--warn-border);
		border-radius: var(--radius);
		background: var(--warn-bg);
		color: var(--warn);
	}
	.error {
		color: var(--warn) !important;
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
	}
</style>
