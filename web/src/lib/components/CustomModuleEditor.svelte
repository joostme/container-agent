<script lang="ts">
	import { miseToml, moduleToml } from '#lib/custom.js';
	import type { CustomModule } from '#lib/types.js';
	import ToolList from './ToolList.svelte';

	interface Props {
		module: CustomModule;
		/** Built-in modules this one can require. */
		builtIn: string[];
		onRemove: () => void;
	}

	let { module = $bindable(), builtIn, onRemove }: Props = $props();

	const kind = $derived(module.daemons.some((d) => d.run.trim()) ? 'service' : 'app');
	const id = $derived(`custom-${module.name || 'new'}`);

	function toggleRequire(name: string) {
		module.requires = module.requires.includes(name)
			? module.requires.filter((r) => r !== name)
			: [...module.requires, name];
	}
	function addVar() {
		module.env = [
			...module.env,
			{ name: '', default: '', description: '', secret: false, required: false, port: '' }
		];
	}
	function addDaemon() {
		module.daemons = [...module.daemons, { name: '', run: '', readyPort: '' }];
	}
</script>

<fieldset>
	<legend>
		<code>{module.name || 'new module'}</code>
		<span class="kind">{kind}</span>
	</legend>

	<div class="grid">
		<div class="field">
			<label for="{id}-name">Name</label>
			<input id="{id}-name" bind:value={module.name} placeholder="e.g. java" spellcheck="false" />
			<small>Lower-case letters, digits and dashes. A built-in name replaces that module.</small>
		</div>
		<div class="field">
			<label for="{id}-desc">Description</label>
			<input id="{id}-desc" bind:value={module.description} placeholder="What it adds" />
		</div>
	</div>

	<div class="block">
		<h4>Requires</h4>
		<div class="chips">
			{#each builtIn as name (name)}
				<button
					type="button"
					class="chip"
					aria-pressed={module.requires.includes(name)}
					onclick={() => toggleRequire(name)}>{name}</button
				>
			{/each}
		</div>
		<small>Enabled with this module and set up before it.</small>
	</div>

	<div class="block">
		<h4>Tools</h4>
		<ToolList bind:tools={module.tools} />
	</div>

	<div class="block grid">
		<div class="field">
			<label for="{id}-packages">apt packages</label>
			<input id="{id}-packages" bind:value={module.packages} placeholder="e.g. ffmpeg imagemagick" spellcheck="false" />
			<small>Debian packages, separated by spaces.</small>
		</div>
	</div>

	<div class="block grid">
		<div class="field">
			<label for="{id}-root">Setup as root</label>
			<textarea id="{id}-root" bind:value={module.rootSetup} rows="3" spellcheck="false" placeholder="e.g. write a file under /etc"></textarea>
			<small>Runs after the apt packages, on every start: keep it repeatable.</small>
		</div>
		<div class="field">
			<label for="{id}-user">Setup as the agent user</label>
			<textarea id="{id}-user" bind:value={module.userSetup} rows="3" spellcheck="false" placeholder="e.g. npm install -g …"></textarea>
			<small>Runs after the tools, with them on the PATH, on every start.</small>
		</div>
	</div>

	<div class="block">
		<h4>Variables</h4>
		{#each module.env as variable, i (i)}
			<div class="row var">
				<input bind:value={variable.name} placeholder="NAME" aria-label="Variable name" spellcheck="false" />
				<input bind:value={variable.default} placeholder="default" aria-label="Default" />
				<input bind:value={variable.description} placeholder="description" aria-label="Description" />
				<select bind:value={variable.port} aria-label="Port">
					<option value="">no port</option>
					<option value="http">http port</option>
					<option value="tcp">tcp port</option>
				</select>
				<label class="check"><input type="checkbox" bind:checked={variable.required} /> required</label>
				<label class="check"><input type="checkbox" bind:checked={variable.secret} /> secret</label>
				<button type="button" onclick={() => (module.env = module.env.filter((_, j) => j !== i))}>Remove</button>
			</div>
		{/each}
		<button type="button" onclick={addVar}>Add variable</button>
		<small class="after">Set their values under Module settings. Ports are published.</small>
	</div>

	<div class="block">
		<h4>Processes</h4>
		{#each module.daemons as daemon, i (i)}
			<div class="row daemon">
				<input bind:value={daemon.name} placeholder={module.name || 'name'} aria-label="Process name" spellcheck="false" />
				<textarea
					bind:value={daemon.run}
					rows="2"
					placeholder="exec my-server --port $MY_PORT"
					aria-label="Command"
					spellcheck="false"
				></textarea>
				<input bind:value={daemon.readyPort} placeholder="ready port" aria-label="Ready port" inputmode="numeric" />
				<button type="button" onclick={() => (module.daemons = module.daemons.filter((_, j) => j !== i))}>Remove</button>
			</div>
		{/each}
		<button type="button" onclick={addDaemon}>Add process</button>
		<small class="after">
			A process makes the module a service. It runs as the agent user in the workspace, restarts when it fails and
			reads variables as <code>$NAME</code>; start it with <code>exec</code>.
		</small>
	</div>

	<div class="block field">
		<label for="{id}-steps">Next steps</label>
		<textarea id="{id}-steps" bind:value={module.nextSteps} rows="2" placeholder="One per line; `commands` run in the container"></textarea>
	</div>

	<details>
		<summary>Generated files</summary>
		<h4>module.toml</h4>
		<pre><code>{moduleToml(module)}</code></pre>
		<h4>mise.toml</h4>
		<pre><code>{miseToml(module) || '# nothing to install'}</code></pre>
	</details>

	<div class="footer">
		<button type="button" onclick={onRemove}>Remove module</button>
	</div>
</fieldset>

<style>
	fieldset {
		margin: 0 0 0.9rem;
		padding: 0.9rem 1rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}
	legend {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0 0.3rem;
		font-weight: 600;
	}
	.kind {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--muted);
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
	.block {
		margin-top: 1rem;
	}
	h4 {
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
	}
	small {
		color: var(--muted);
		font-size: 0.85rem;
	}
	small.after {
		display: block;
		margin-top: 0.3rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-bottom: 0.3rem;
	}
	.chip {
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		font-family: var(--mono);
		font-size: 0.8rem;
	}
	.chip[aria-pressed='true'] {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.row {
		display: grid;
		gap: 0.4rem;
		align-items: start;
		margin-bottom: 0.5rem;
	}
	.row.var {
		grid-template-columns: 9rem 8rem minmax(0, 1fr) 7.5rem auto auto auto;
	}
	.row.daemon {
		grid-template-columns: 9rem minmax(0, 1fr) 7rem auto;
	}
	@media (max-width: 900px) {
		.row.var,
		.row.daemon {
			grid-template-columns: 1fr 1fr;
		}
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
		font-size: 0.85rem;
		padding-top: 0.45rem;
	}
	textarea {
		font-family: var(--mono);
		font-size: 0.85rem;
	}
	details {
		margin-top: 1rem;
	}
	summary {
		cursor: pointer;
		color: var(--muted);
	}
	pre {
		margin: 0 0 0.6rem;
		padding: 0.6rem;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-2);
		font-size: 0.8rem;
	}
	.footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.8rem;
	}
</style>
