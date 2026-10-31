<script lang="ts" module>
	export interface ToolRow {
		name: string;
		/** A version, or a table with installer options (edited as TOML). */
		value: unknown;
	}
</script>

<script lang="ts">
	import miseTools from '#lib/mise-tools.json';

	interface Props {
		rows: ToolRow[];
		onchange: () => void;
	}

	let { rows = $bindable(), onchange }: Props = $props();

	// The <datalist id="mise-tools"> with these names is rendered once by the page
	const known = new Map((miseTools as { name: string; description: string }[]).map((t) => [t.name, t.description]));

	// Backends such as npm:, pipx:, cargo: or github: take any package
	const hint = (name: string): { text: string; unknown: boolean } => {
		const trimmed = name.trim();
		if (!trimmed) return { text: '', unknown: false };
		if (known.has(trimmed)) return { text: known.get(trimmed) ?? '', unknown: false };
		if (trimmed.includes(':')) return { text: 'Installed through its backend', unknown: false };
		return { text: 'Not in the mise registry; prefix a backend, e.g. npm: or pipx:', unknown: known.size > 0 };
	};

	function add() {
		rows = [...rows, { name: '', value: 'latest' }];
	}

	function remove(index: number) {
		rows = rows.filter((_, i) => i !== index);
		onchange();
	}
</script>

{#if rows.length > 0}
	<div class="rows">
		{#each rows as row, i (i)}
			{@const info = hint(row.name)}
			<div class="row">
				<div class="name">
					<input
						bind:value={row.name}
						list="mise-tools"
						placeholder="e.g. java, terraform, npm:prettier"
						aria-label="Tool"
						autocomplete="off"
						spellcheck="false"
					/>
					{#if info.text}<small class:unknown={info.unknown} title={info.text}>{info.text}</small>{/if}
				</div>
				{#if typeof row.value === 'string'}
					<input bind:value={row.value} placeholder="latest" aria-label="Version" spellcheck="false" />
				{:else}
					<input value="options, see TOML" aria-label="Version" disabled />
				{/if}
				<button type="button" onclick={() => remove(i)} aria-label="Remove {row.name || 'tool'}">Remove</button>
			</div>
		{/each}
	</div>
{/if}

<button type="button" onclick={add}>Add tool</button>

<style>
	.rows {
		display: grid;
		gap: 0.6rem;
		margin-bottom: 0.7rem;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 9rem auto;
		gap: 0.5rem;
		align-items: start;
	}
	.name {
		display: grid;
		gap: 0.2rem;
	}
	small {
		color: var(--muted);
		font-size: 0.82rem;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}
	small.unknown {
		color: var(--warn);
	}
</style>
