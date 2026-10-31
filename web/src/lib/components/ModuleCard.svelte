<script lang="ts">
	import type { CatalogEntry, Module } from '#lib/types.js';
	import Inline from './Inline.svelte';

	interface Props {
		name: string;
		entry: CatalogEntry;
		/** File of the shown version, once loaded. */
		module: Module | undefined;
		picked: boolean;
		/** Modules that require this one; it is enabled through them. */
		requiredBy: string[];
		/** Versions the selected image reads, newest first. */
		versions: string[];
		/** The version in use, when enabled. */
		version: string | null;
		/** Replaced by a custom module of the same name. */
		replaced: boolean;
		onToggle: () => void;
		onVersion: (version: string) => void;
	}

	let { name, entry, module, picked, requiredBy, versions, version, replaced, onToggle, onVersion }: Props = $props();

	const enabled = $derived(picked || requiredBy.length > 0);
	const locked = $derived(!picked && requiredBy.length > 0);
	const ports = $derived(
		(module?.env ?? []).filter((v) => v.type === 'port').map((v) => `${v.default}/${v.protocol ?? 'tcp'}`)
	);
	const secrets = $derived((module?.env ?? []).filter((v) => v.type === 'secret').map((v) => v.name));
</script>

<div class="card" class:enabled class:locked>
	<label class="main">
		<input type="checkbox" checked={enabled} disabled={locked || replaced} onchange={onToggle} />
		<div class="body">
			<div class="head">
				<span class="name">{name}</span>
				{#if locked}<span class="tag">needed by {requiredBy.join(', ')}</span>{/if}
				{#if replaced}<span class="tag">replaced by your custom module</span>{/if}
			</div>
			<p><Inline text={entry.description} /></p>
		</div>
	</label>
	<div class="chips">
		{#each entry.tags as tag (tag)}<span class="chip tagchip">{tag}</span>{/each}
		{#each entry.requires as dep (dep)}<span class="chip">needs {dep}</span>{/each}
		{#each ports as port (port)}<span class="chip">port {port}</span>{/each}
		{#each module?.commands ?? [] as command (command)}<span class="chip mono" title="command in the container">{command}</span>{/each}
		{#each secrets as secret (secret)}<span class="chip" title="reads this secret">secret {secret}</span>{/each}
		{#each module?.root ?? [] as part (part.what)}
			<span class="chip root" title={part.run}>root: {part.what}</span>
		{/each}
		{#if module?.arch}<span class="chip">only {module.arch.join(', ')}</span>{/if}
	</div>
	{#if enabled && version && !replaced}
		<div class="version">
			<select
				aria-label="Version of {name}"
				value={version}
				onchange={(e) => onVersion(e.currentTarget.value)}
			>
				{#if !versions.includes(version)}<option value={version}>{version} (not for this image)</option>{/if}
				{#each versions as v, i (v)}
					<option value={v}>{v}{i === 0 ? ' (newest)' : ''}</option>
				{/each}
			</select>
			{#if entry.homepage}<a href={entry.homepage} target="_blank" rel="noreferrer">homepage</a>{/if}
		</div>
	{/if}
</div>

<style>
	.card {
		display: grid;
		gap: 0.4rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.card:hover {
		border-color: var(--accent);
	}
	.card.enabled {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.main {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
		cursor: pointer;
	}
	.locked .main {
		cursor: default;
	}
	input {
		margin-top: 0.25rem;
		width: 1.05rem;
		height: 1.05rem;
		accent-color: var(--accent);
	}
	.body {
		min-width: 0;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: baseline;
	}
	.name {
		font-family: var(--mono);
		font-weight: 600;
	}
	.tag {
		font-size: 0.78rem;
		color: var(--muted);
	}
	p {
		margin: 0.2rem 0 0;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		font-size: 0.75rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--muted);
	}
	.chip.mono {
		font-family: var(--mono);
	}
	.chip.tagchip {
		border: 1px solid var(--border);
		background: none;
	}
	.chip.root {
		background: var(--warn-bg);
		color: var(--warn);
	}
	.version {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.85rem;
	}
	.version select {
		width: auto;
		padding: 0.2rem 0.4rem;
	}
</style>
