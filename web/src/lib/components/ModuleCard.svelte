<script lang="ts">
	import type { Module } from '#lib/types.js';
	import Inline from './Inline.svelte';

	interface Props {
		module: Module;
		picked: boolean;
		/** Modules that require this one; it is enabled through them. */
		requiredBy: string[];
		/** Replaced by a custom module of the same name. */
		replaced: boolean;
		onToggle: () => void;
	}

	let { module, picked, requiredBy, replaced, onToggle }: Props = $props();

	const enabled = $derived(picked || requiredBy.length > 0);
	const locked = $derived(!picked && requiredBy.length > 0);
	const ports = $derived(
		module.env.filter((v) => v.type === 'port').map((v) => `${v.default}/${v.protocol ?? 'tcp'}`)
	);
	const secrets = $derived(module.env.filter((v) => v.type === 'secret').map((v) => v.name));
</script>

<div class="card" class:enabled class:locked>
	<label class="main">
		<input type="checkbox" checked={enabled} disabled={locked || replaced} onchange={onToggle} />
		<div class="body">
			<div class="head">
				<span class="name">{module.name}</span>
				{#if module.version}<span class="tag">{module.version}</span>{/if}
				{#if locked}<span class="tag">needed by {requiredBy.join(', ')}</span>{/if}
				{#if replaced}<span class="tag">replaced by your custom module</span>{/if}
			</div>
			<p><Inline text={module.description} /></p>
		</div>
	</label>
	<div class="chips">
		{#each module.tags as tag (tag)}<span class="chip tagchip">{tag}</span>{/each}
		{#each module.requires as dep (dep)}<span class="chip">needs {dep}</span>{/each}
		{#each ports as port (port)}<span class="chip">port {port}</span>{/each}
		{#each module.commands as command (command)}<span class="chip mono" title="command in the container">{command}</span>{/each}
		{#each secrets as secret (secret)}<span class="chip" title="reads this secret">secret {secret}</span>{/each}
		{#each module.root as part (part.what)}
			<span class="chip root" title={part.run}>root: {part.what}</span>
		{/each}
	</div>
	{#if module.homepage}<a class="homepage" href={module.homepage} target="_blank" rel="noreferrer">homepage</a>{/if}
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
	.homepage {
		font-size: 0.85rem;
	}
</style>
