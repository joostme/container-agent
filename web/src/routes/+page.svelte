<script lang="ts">
	import { onMount } from 'svelte';
	import ModuleCard from '#lib/components/ModuleCard.svelte';
	import OutputPanel from '#lib/components/OutputPanel.svelte';
	import VarField from '#lib/components/VarField.svelte';
	import { defaultConfig, generate } from '#lib/generate.js';
	import registryJson from '#lib/registry.json';
	import { decodeHash, encodeHash, importCompose } from '#lib/share.js';
	import type { Module, Registry } from '#lib/types.js';

	const registry = registryJson as Registry;
	const repo = 'https://github.com/joostme/container-agent';

	let config = $state(defaultConfig(registry));
	let ready = $state(false);
	let linkCopied = $state(false);
	let importDialog: HTMLDialogElement;
	let importText = $state('');
	let importError = $state('');

	const output = $derived(generate(config, registry));
	const enabled = $derived(new Set(output.resolution.order.map((m) => m.name)));
	const configurable = $derived(output.resolution.order.filter((m) => m.env.length > 0));

	const groups: { title: string; hint: string; modules: Module[] }[] = [
		{
			title: 'Services',
			hint: 'Run a process: remote control, web UIs, servers',
			modules: registry.modules.filter((m) => m.kind === 'service')
		},
		{
			title: 'Apps',
			hint: 'Install and set up: agents, CLIs, runtimes',
			modules: registry.modules.filter((m) => m.kind === 'app')
		}
	];

	function toggle(name: string) {
		config.modules = config.modules.includes(name)
			? config.modules.filter((m) => m !== name)
			: [...config.modules, name];
	}

	function loadHash() {
		const fromHash = decodeHash(location.hash, registry);
		if (fromHash) config = fromHash;
	}

	onMount(() => {
		loadHash();
		ready = true;
		// a pasted link in the same tab only changes the hash
		window.addEventListener('hashchange', loadHash);
		return () => window.removeEventListener('hashchange', loadHash);
	});

	// Keep the link in the address bar current (without secrets)
	$effect(() => {
		const hash = encodeHash(config, registry);
		if (ready) history.replaceState(history.state, '', `#${hash}`);
	});

	async function copyLink() {
		await navigator.clipboard.writeText(location.href);
		linkCopied = true;
		setTimeout(() => (linkCopied = false), 1500);
	}

	function openImport() {
		importError = '';
		importDialog.showModal();
	}

	async function loadFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (file) importText = await file.text();
	}

	function applyImport() {
		try {
			config = importCompose(importText, registry);
			importDialog.close();
			importText = '';
		} catch (error) {
			importError = (error as Error).message;
		}
	}

	function reset() {
		config = defaultConfig(registry);
	}
</script>

<header>
	<div class="title">
		<h1>container-agent <span>configurator</span></h1>
		<p>
			Pick agents and remote UIs, fill in their settings and get a <code>compose.yaml</code> for
			<a href={repo}>container-agent</a>
			<code>{registry.version}</code>.
		</p>
	</div>
	<div class="header-actions">
		<button onclick={openImport}>Load compose.yaml</button>
		<button onclick={copyLink} title="Secrets are not part of the link">
			{linkCopied ? 'Link copied' : 'Copy link'}
		</button>
		<button onclick={reset}>Reset</button>
	</div>
</header>

<main>
	<div class="config">
		<section>
			<h2><span>1</span> Modules</h2>
			{#each groups as group (group.title)}
				<h3>{group.title} <span>{group.hint}</span></h3>
				<div class="cards">
					{#each group.modules as module (module.name)}
						<ModuleCard
							{module}
							picked={config.modules.includes(module.name)}
							requiredBy={output.resolution.requiredBy.get(module.name) ?? []}
							onToggle={() => toggle(module.name)}
						/>
					{/each}
				</div>
			{/each}
		</section>

		<section>
			<h2><span>2</span> Module settings</h2>
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
			<h2><span>3</span> Container</h2>
			<div class="grid">
				<div class="field">
					<label for="service">Service and host name</label>
					<input id="service" bind:value={config.service} />
					<small>Also the name Codex Remote Control shows.</small>
				</div>
				<div class="field">
					<label for="tag">Image tag</label>
					<input id="tag" bind:value={config.imageTag} />
					<small>Modules shown here belong to <code>{registry.version}</code>.</small>
				</div>
				<div class="field">
					<label for="puid">PUID</label>
					<input id="puid" bind:value={config.puid} inputmode="numeric" />
					<small>Your host user, see <code>id -u</code>.</small>
				</div>
				<div class="field">
					<label for="pgid">PGID</label>
					<input id="pgid" bind:value={config.pgid} inputmode="numeric" />
					<small>Your host group, see <code>id -g</code>.</small>
				</div>
				<div class="field">
					<label for="tz">Time zone</label>
					<input id="tz" bind:value={config.tz} placeholder="e.g. Europe/Berlin" />
				</div>
				<div class="field">
					<label for="user">Agent user</label>
					<input id="user" bind:value={config.agentUser} />
				</div>
				<div class="field">
					<label for="data">Data directory on the host</label>
					<input id="data" bind:value={config.dataDir} />
					<small>Holds <code>home</code> (logins, tools) and <code>repos</code>.</small>
				</div>
				<div class="field">
					<label for="ssh">SSH keys on the host</label>
					<input id="ssh" bind:value={config.sshKeys} placeholder="e.g. ~/.ssh, empty for none" />
					<small>Mounted read-only and copied into <code>~/.ssh</code>.</small>
				</div>
				<label class="check">
					<input type="checkbox" bind:checked={config.autoUpdate} />
					Upgrade tools on every start
				</label>
			</div>
		</section>

	</div>

	<aside>
		<OutputPanel {output} />
	</aside>
</main>

<dialog bind:this={importDialog}>
	<form method="dialog" onsubmit={(e) => (e.preventDefault(), applyImport())}>
		<h2>Load compose.yaml</h2>
		<p>Paste a file from this configurator or pick it. Secrets are not stored in it; enter them again.</p>
		<input type="file" accept=".yaml,.yml" onchange={loadFile} />
		<textarea bind:value={importText} rows="12" spellcheck="false"></textarea>
		{#if importError}<p class="error">{importError}</p>{/if}
		<div class="dialog-actions">
			<button type="button" onclick={() => importDialog.close()}>Cancel</button>
			<button class="primary" type="submit">Load</button>
		</div>
	</form>
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
	dialog {
		width: min(680px, 92vw);
		padding: 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.45);
	}
	dialog form {
		display: grid;
		gap: 0.7rem;
	}
	dialog h2 {
		margin: 0;
	}
	dialog p {
		margin: 0;
		color: var(--muted);
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
