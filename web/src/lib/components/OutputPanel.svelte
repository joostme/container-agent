<script lang="ts">
	import type { Output } from '#lib/generate.js';
	import { zip } from '#lib/share.js';

	interface Props {
		output: Output;
		/** Folder name inside the zip. */
		folder: string;
	}

	let { output, folder }: Props = $props();

	let tab = $state('compose.yaml');
	let copied = $state<string | null>(null);

	const file = $derived(output.files.find((f) => f.path === tab));
	$effect(() => {
		if (tab !== 'steps' && !file) tab = 'compose.yaml';
	});

	async function copy(text: string, what: string) {
		await navigator.clipboard.writeText(text);
		copied = what;
		setTimeout(() => (copied = null), 1500);
	}

	function save(name: string, data: BlobPart, type: string) {
		const url = URL.createObjectURL(new Blob([data], { type }));
		const link = Object.assign(document.createElement('a'), { href: url, download: name });
		link.click();
		URL.revokeObjectURL(url);
	}

	const label = (path: string) => path.replace(/^config\//, '');
</script>

<div class="panel">
	<div class="actions">
		<button class="primary" onclick={() => save(`${folder}.zip`, zip(output.files, folder) as BlobPart, 'application/zip')}>
			Download all (.zip)
		</button>
		<span>{output.files.map((f) => f.path).join(', ')}</span>
	</div>

	<div class="tabs" role="tablist">
		{#each output.files as f (f.path)}
			<button role="tab" aria-selected={tab === f.path} onclick={() => (tab = f.path)}>{label(f.path)}</button>
		{/each}
		<button role="tab" aria-selected={tab === 'steps'} onclick={() => (tab = 'steps')}>Next steps</button>
	</div>

	{#if tab === 'steps'}
		<ol class="steps">
			{#each output.steps as step, i (i)}
				<li>
					{#each step.parts as part, j (j)}
						{#if part.command}
							<button class="command" title="Copy" onclick={() => copy(part.text, part.text)}>
								<code>{part.text}</code>
								<span class="state">{copied === part.text ? 'copied' : 'copy'}</span>
							</button>
						{:else}{part.text}{/if}
					{/each}
				</li>
			{/each}
		</ol>
	{:else if file}
		<div class="actions">
			<button onclick={() => copy(file.text, file.path)}>{copied === file.path ? 'Copied' : 'Copy'}</button>
			<button onclick={() => save(file.path.split('/').at(-1) ?? file.path, file.text, 'text/plain')}>Download</button>
			<code class="path">{file.path}</code>
		</div>
		<pre><code>{file.text}</code></pre>
	{/if}
</div>

<style>
	.panel {
		display: grid;
		gap: 0.7rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.actions span,
	.path {
		color: var(--muted);
		font-size: 0.82rem;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		border-bottom: 1px solid var(--border);
	}
	.tabs button {
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		background: none;
		padding: 0.4rem 0.7rem;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.85rem;
	}
	.tabs button[aria-selected='true'] {
		color: var(--text);
		border-bottom-color: var(--accent);
		font-weight: 600;
	}
	pre {
		margin: 0;
		padding: 0.8rem;
		max-height: 65vh;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-2);
		font-size: 0.82rem;
		line-height: 1.45;
	}
	.steps {
		margin: 0;
		padding-left: 1.3rem;
		display: grid;
		gap: 0.7rem;
	}
	.command {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5rem;
		max-width: 100%;
		margin: 0.1rem 0;
		padding: 0.15rem 0.5rem;
		text-align: left;
		background: var(--surface-2);
	}
	.command code {
		overflow-wrap: anywhere;
	}
	.state {
		flex: none;
		font-size: 0.75rem;
		color: var(--muted);
	}
</style>
