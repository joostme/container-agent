<script lang="ts">
	import type { Module } from '#lib/types.js';
	import Inline from './Inline.svelte';

	interface Props {
		module: Module;
		picked: boolean;
		/** Modules that require this one; it is enabled through them. */
		requiredBy: string[];
		onToggle: () => void;
	}

	let { module, picked, requiredBy, onToggle }: Props = $props();

	const enabled = $derived(picked || requiredBy.length > 0);
	const locked = $derived(!picked && requiredBy.length > 0);
	const ports = $derived(module.env.filter((v) => v.port).map((v) => `${v.default}/${v.port}`));
</script>

<label class="card" class:enabled class:locked>
	<input type="checkbox" checked={enabled} disabled={locked} onchange={onToggle} />
	<div class="body">
		<div class="head">
			<span class="name">{module.name}</span>
			{#if locked}
				<span class="tag auto">needed by {requiredBy.join(', ')}</span>
			{/if}
		</div>
		<p><Inline text={module.description} /></p>
		<div class="chips">
			{#each module.requires as dep (dep)}
				<span class="chip">needs {dep}</span>
			{/each}
			{#each ports as port (port)}
				<span class="chip">port {port}</span>
			{/each}
			{#each module.commands as command (command)}
				<span class="chip mono">{command}</span>
			{/each}
			{#if module.arch}
				<span class="chip">only {module.arch.join(', ')}</span>
			{/if}
		</div>
	</div>
</label>

<style>
	.card {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		cursor: pointer;
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
	.card.locked {
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
		margin: 0.2rem 0 0.4rem;
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
</style>
