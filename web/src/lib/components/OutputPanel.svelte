<script lang="ts">
	import type { Output } from '#lib/generate.js';

	interface Props {
		output: Output;
	}

	let { output }: Props = $props();

	type Tab = 'compose' | 'env' | 'steps';
	let tab = $state<Tab>('compose');
	let copied = $state<string | null>(null);

	const files: Record<Exclude<Tab, 'steps'>, { name: string; text: () => string }> = {
		compose: { name: 'compose.yaml', text: () => output.compose },
		env: { name: '.env', text: () => output.env }
	};

	async function copy(text: string, what: string) {
		await navigator.clipboard.writeText(text);
		copied = what;
		setTimeout(() => (copied = null), 1500);
	}

	function download(name: string, text: string) {
		const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
		const link = Object.assign(document.createElement('a'), { href: url, download: name });
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="panel">
	{#if output.warnings.length}
		<ul class="warnings" aria-live="polite">
			{#each output.warnings as warning (warning)}
				<li>{warning}</li>
			{/each}
		</ul>
	{/if}

	<div class="tabs" role="tablist">
		<button role="tab" aria-selected={tab === 'compose'} onclick={() => (tab = 'compose')}>compose.yaml</button>
		<button role="tab" aria-selected={tab === 'env'} onclick={() => (tab = 'env')}>.env</button>
		<button role="tab" aria-selected={tab === 'steps'} onclick={() => (tab = 'steps')}>Next steps</button>
	</div>

	{#if tab === 'steps'}
		<ol class="steps">
			{#each output.steps as step (step.text)}
				<li>
					{#each step.parts as part, i (i)}
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
	{:else}
		{@const file = files[tab]}
		<div class="actions">
			<button class="primary" onclick={() => copy(file.text(), file.name)}>
				{copied === file.name ? 'Copied' : `Copy ${file.name}`}
			</button>
			<button onclick={() => download(file.name, file.text())}>Download</button>
		</div>
		<pre><code>{file.text()}</code></pre>
	{/if}
</div>

<style>
	.panel {
		display: grid;
		gap: 0.7rem;
	}
	.warnings {
		margin: 0;
		padding: 0.6rem 0.8rem 0.6rem 1.8rem;
		border: 1px solid var(--warn-border);
		border-radius: var(--radius);
		background: var(--warn-bg);
		color: var(--warn);
		font-size: 0.88rem;
	}
	.tabs {
		display: flex;
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
	}
	.tabs button[aria-selected='true'] {
		color: var(--text);
		border-bottom-color: var(--accent);
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
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
