<script lang="ts">
	import { fromToml, problems, strings, table, text, toToml } from '#lib/module.js';
	import { VAR_TYPES, type Doc } from '#lib/types.js';
	import ToolList, { type ToolRow } from './ToolList.svelte';

	interface Props {
		doc: Doc;
		/** Modules this one can require or come after. */
		others: string[];
		formats: number[];
		onRemove: () => void;
		onShare: () => Promise<void>;
	}

	let { doc = $bindable(), others, formats, onRemove, onShare }: Props = $props();

	type Row = { name: string; spec: Doc };

	const rowsOf = (value: unknown): Row[] =>
		Object.entries(table(value)).map(([name, spec]) => ({ name, spec: { ...table(spec) } }));

	// Rows of the tables the forms edit; written back to the file on every change.
	// Keys without a form stay in `spec` and so in the file.
	let tools = $state<ToolRow[]>([]);
	let vars = $state<Row[]>([]);
	let tasks = $state<Row[]>([]);
	let daemons = $state<Row[]>([]);
	let raw = $state('');
	let rawError = $state('');
	let shared = $state(false);

	function load() {
		const mise = table(doc.mise);
		tools = Object.entries(table(mise.tools)).map(([name, value]) => ({ name, value }));
		// the selects need a value for "string" and "tcp"; clean() drops it again
		vars = rowsOf(doc.env).map((r) => ({ ...r, spec: { type: '', protocol: '', ...r.spec } }));
		tasks = rowsOf(mise.tasks);
		daemons = rowsOf(doc.daemons);
		raw = toToml(doc);
		rawError = '';
	}
	load();

	const kind = $derived(Object.keys(table(doc.daemons)).length ? 'service' : 'app');
	const id = $derived(`module-${text(doc.name) || 'new'}`);
	const issues = $derived(problems(doc, formats));

	/** Drops form defaults, so the file only holds what was set. */
	function clean(spec: Doc): Doc {
		return Object.fromEntries(
			Object.entries(spec).filter(
				([, v]) => v !== '' && v !== false && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)
			)
		);
	}
	const tableOf = (rows: Row[]) =>
		Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), clean(r.spec)]));

	function mise(): Doc {
		doc.mise = table(doc.mise);
		return doc.mise as Doc;
	}
	function bootstrap(): Doc {
		const m = mise();
		m.bootstrap = table(m.bootstrap);
		return m.bootstrap as Doc;
	}
	function hook(name: 'post-packages' | 'post-tools', run: string) {
		const b = bootstrap();
		const hooks = table(b.hooks);
		hooks[name] = { ...table(hooks[name]), run };
		b.hooks = hooks;
	}

	function sync() {
		const m = mise();
		m.tools = Object.fromEntries(tools.filter((t) => t.name.trim()).map((t) => [t.name.trim(), t.value || 'latest']));
		m.tasks = tableOf(tasks);
		doc.env = tableOf(vars);
		doc.daemons = tableOf(daemons);
		raw = toToml(doc);
	}

	function setList(key: 'tags' | 'next_steps', value: string, separator: RegExp) {
		doc[key] = value
			.split(separator)
			.map((s) => s.trim())
			.filter(Boolean);
		sync();
	}

	function toggle(key: 'requires' | 'after', name: string) {
		const list = strings(doc[key]);
		doc[key] = list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
		sync();
	}

	function applyRaw() {
		try {
			doc = fromToml(raw);
			load();
		} catch (error) {
			rawError = (error as Error).message;
		}
	}

	async function share() {
		await onShare();
		shared = true;
		setTimeout(() => (shared = false), 1500);
	}

	function download() {
		const url = URL.createObjectURL(new Blob([toToml(doc)], { type: 'application/toml' }));
		const link = Object.assign(document.createElement('a'), { href: url, download: `${text(doc.name) || 'module'}.toml` });
		link.click();
		URL.revokeObjectURL(url);
	}

	const packages = $derived(
		Object.keys(table(table(table(doc.mise).bootstrap).packages))
			.map((p) => p.replace(/^apt:/, ''))
			.join(' ')
	);
	function setPackages(value: string) {
		const b = bootstrap();
		const old = table(b.packages);
		b.packages = Object.fromEntries(
			value
				.split(/\s+/)
				.filter(Boolean)
				.map((p) => [`apt:${p}`, old[`apt:${p}`] ?? 'latest'])
		);
		sync();
	}
	const hookRun = (name: string) => text(table(table(table(table(doc.mise).bootstrap).hooks)[name]).run);
</script>

<fieldset>
	<legend>
		<code>{text(doc.name) || 'new module'}</code>
		<span class="kind">{kind}</span>
	</legend>

	{#if issues.length}
		<ul class="issues">
			{#each issues as issue (issue)}<li>{issue}</li>{/each}
		</ul>
	{/if}

	<div class="grid" oninput={sync}>
		<div class="field">
			<label for="{id}-name">Name</label>
			<input id="{id}-name" bind:value={doc.name} placeholder="e.g. jupyter" spellcheck="false" />
			<small>Lower-case letters, digits and dashes; the file is <code>modules/{text(doc.name) || 'name'}.toml</code>.</small>
		</div>
		<div class="field">
			<label for="{id}-desc">Description</label>
			<input id="{id}-desc" bind:value={doc.description} placeholder="What it adds" />
		</div>
		<div class="field">
			<label for="{id}-version">Version</label>
			<input id="{id}-version" bind:value={doc.version} placeholder="e.g. 1.0.0" spellcheck="false" />
			<small>Needed for the catalog.</small>
		</div>
		<div class="field">
			<label for="{id}-tags">Tags</label>
			<input
				id="{id}-tags"
				value={strings(doc.tags).join(', ')}
				oninput={(e) => setList('tags', e.currentTarget.value, /,/)}
				placeholder="e.g. notebook, python"
			/>
		</div>
	</div>

	{#each [['requires', 'Requires', 'Enabled with this module and set up before it.'], ['after', 'After', 'Set up and started after these, if they are enabled.']] as [key, title, hint] (key)}
		<div class="block">
			<h4>{title}</h4>
			<div class="chips">
				{#each others as name (name)}
					<button
						type="button"
						class="chip"
						aria-pressed={strings(doc[key]).includes(name)}
						onclick={() => toggle(key as 'requires' | 'after', name)}>{name}</button
					>
				{/each}
			</div>
			<small>{hint}</small>
		</div>
	{/each}

	<div class="block">
		<h4>Tools <a href="https://mise.jdx.dev/registry.html" target="_blank" rel="noreferrer">mise registry</a></h4>
		<div oninput={sync}>
			<ToolList bind:rows={tools} onchange={sync} />
		</div>
	</div>

	<div class="block grid">
		<div class="field">
			<label for="{id}-packages">apt packages</label>
			<input
				id="{id}-packages"
				value={packages}
				onchange={(e) => setPackages(e.currentTarget.value)}
				placeholder="e.g. ffmpeg imagemagick"
				spellcheck="false"
			/>
			<small>Debian packages, separated by spaces.</small>
		</div>
	</div>

	<div class="block grid">
		<div class="field">
			<label for="{id}-root">Setup as root</label>
			<textarea
				id="{id}-root"
				value={hookRun('post-packages')}
				oninput={(e) => (hook('post-packages', e.currentTarget.value), sync())}
				rows="3"
				spellcheck="false"
				placeholder="e.g. write a file under /etc"
			></textarea>
			<small>After the apt packages, on every start: keep it repeatable.</small>
		</div>
		<div class="field">
			<label for="{id}-user">Setup as the agent user</label>
			<textarea
				id="{id}-user"
				value={hookRun('post-tools')}
				oninput={(e) => (hook('post-tools', e.currentTarget.value), sync())}
				rows="3"
				spellcheck="false"
				placeholder="e.g. npm install -g …"
			></textarea>
			<small>After the tools, with them on the PATH, on every start.</small>
		</div>
	</div>

	<div class="block" oninput={sync} onchange={sync}>
		<h4>Variables</h4>
		{#each vars as v, i (i)}
			<div class="row var">
				<input bind:value={v.name} placeholder="NAME" aria-label="Variable name" spellcheck="false" />
				<select bind:value={v.spec.type} aria-label="Type">
					{#each VAR_TYPES as type (type)}<option value={type === 'string' ? '' : type}>{type}</option>{/each}
				</select>
				<input bind:value={v.spec.default} placeholder="default" aria-label="Default" />
				<label class="check"><input
						type="checkbox"
						checked={v.spec.required === true}
						onchange={(e) => (v.spec.required = e.currentTarget.checked)}
					/> required</label>
				<button type="button" onclick={() => ((vars = vars.filter((_, j) => j !== i)), sync())}>Remove</button>
				<input class="wide" bind:value={v.spec.description} placeholder="description" aria-label="Description" />
				{#if v.spec.type === 'choice'}
					<input
						class="wide"
						value={strings(v.spec.choices).join(', ')}
						oninput={(e) => (v.spec.choices = e.currentTarget.value.split(',').map((c) => c.trim()).filter(Boolean))}
						placeholder="choices, separated by commas"
						aria-label="Choices"
					/>
				{/if}
				{#if v.spec.type === 'port'}
					<select class="wide" bind:value={v.spec.protocol} aria-label="Protocol">
						<option value="">tcp</option>
						<option value="http">http</option>
					</select>
				{/if}
			</div>
		{/each}
		<button type="button" onclick={() => (vars = [...vars, { name: '', spec: {} }])}>Add variable</button>
		<small class="after">Values are set under Settings; secrets go to <code>.env</code>, ports are published.</small>
	</div>

	<div class="block" oninput={sync} onchange={sync}>
		<h4>Commands</h4>
		{#each tasks as t, i (i)}
			<div class="row task">
				<input bind:value={t.name} placeholder="{text(doc.name) || 'name'}-hello" aria-label="Command name" spellcheck="false" />
				<input bind:value={t.spec.description} placeholder="description" aria-label="Description" />
				<button type="button" onclick={() => ((tasks = tasks.filter((_, j) => j !== i)), sync())}>Remove</button>
				{#if typeof t.spec.run === 'string' || t.spec.run === undefined}
					<textarea class="wide" bind:value={t.spec.run} rows="2" placeholder="echo hello" aria-label="Script" spellcheck="false"></textarea>
				{:else}
					<small class="wide">A list of commands; edit it as TOML.</small>
				{/if}
			</div>
		{/each}
		<button type="button" onclick={() => (tasks = [...tasks, { name: '', spec: {} }])}>Add command</button>
		<small class="after">mise tasks; each becomes a command in the container, run as the agent user.</small>
	</div>

	<div class="block" oninput={sync} onchange={sync}>
		<h4>Processes</h4>
		{#each daemons as d, i (i)}
			<div class="row daemon">
				<input bind:value={d.name} placeholder={text(doc.name) || 'name'} aria-label="Process name" spellcheck="false" />
				<input
					value={text(d.spec.ready_port)}
					oninput={(e) => (d.spec.ready_port = /^\d+$/.test(e.currentTarget.value) ? Number(e.currentTarget.value) : undefined)}
					placeholder="ready port"
					aria-label="Ready port"
					inputmode="numeric"
				/>
				<label class="check"><input
						type="checkbox"
						checked={d.spec.retry !== undefined && d.spec.retry !== false}
						onchange={(e) => (d.spec.retry = e.currentTarget.checked)}
					/> restart</label>
				<label class="check">
					<input
						type="checkbox"
						checked={d.spec.user === 'root'}
						onchange={(e) => (d.spec.user = e.currentTarget.checked ? 'root' : undefined)}
					/> as root
				</label>
				<button type="button" onclick={() => ((daemons = daemons.filter((_, j) => j !== i)), sync())}>Remove</button>
				<textarea
					class="wide"
					bind:value={d.spec.run}
					rows="2"
					placeholder="exec my-server --port $MY_PORT"
					aria-label="Command"
					spellcheck="false"
				></textarea>
				<input class="wide" bind:value={d.spec.ready_cmd} placeholder="ready check command, e.g. curl -sf http://127.0.0.1:$MY_PORT/" aria-label="Ready command" spellcheck="false" />
			</div>
		{/each}
		<button type="button" onclick={() => (daemons = [...daemons, { name: '', spec: { retry: true } }])}>Add process</button>
		<small class="after">
			pitchfork daemons; a process makes the module a service. It runs in the workspace with the tools and variables
			(<code>$NAME</code>); start it with <code>exec</code>. Other options such as <code>depends</code> go into the TOML.
		</small>
	</div>

	<div class="block field">
		<label for="{id}-steps">Next steps</label>
		<textarea
			id="{id}-steps"
			value={strings(doc.next_steps).join('\n')}
			oninput={(e) => setList('next_steps', e.currentTarget.value, /\n/)}
			rows="2"
			placeholder="One per line; `commands` run in the container"
		></textarea>
	</div>

	<details>
		<summary>TOML</summary>
		<textarea class="raw" bind:value={raw} rows="16" spellcheck="false" aria-label="Module as TOML"></textarea>
		{#if rawError}<p class="error">{rawError}</p>{/if}
		<div class="footer">
			<button type="button" onclick={load}>Discard changes</button>
			<button type="button" class="primary" onclick={applyRaw}>Apply TOML</button>
		</div>
	</details>

	<div class="footer">
		<button type="button" onclick={share} title="A link that carries this module">{shared ? 'Link copied' : 'Share link'}</button>
		<button type="button" onclick={download}>Download .toml</button>
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
	.issues {
		margin: 0 0 0.6rem;
		padding: 0.5rem 0.8rem 0.5rem 1.6rem;
		border: 1px solid var(--warn-border);
		border-radius: var(--radius);
		background: var(--warn-bg);
		color: var(--warn);
		font-size: 0.85rem;
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
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
	}
	h4 a {
		font-weight: 400;
		font-size: 0.8rem;
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
		margin-bottom: 0.7rem;
		padding-bottom: 0.7rem;
		border-bottom: 1px dashed var(--border);
	}
	.row .wide {
		grid-column: 1 / -1;
	}
	.row.var {
		grid-template-columns: 10rem 7rem minmax(0, 1fr) auto auto;
	}
	.row.task {
		grid-template-columns: 12rem minmax(0, 1fr) auto;
	}
	.row.daemon {
		grid-template-columns: 10rem 7rem auto auto auto;
	}
	@media (max-width: 900px) {
		.row.var,
		.row.task,
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
	.raw {
		margin-top: 0.5rem;
	}
	.error {
		color: var(--warn);
		font-size: 0.85rem;
	}
	.footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
		margin-top: 0.8rem;
	}
</style>
