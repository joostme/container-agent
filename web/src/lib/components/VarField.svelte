<script lang="ts">
	import type { EnvVar } from '#lib/types.js';
	import Inline from './Inline.svelte';

	interface Props {
		variable: EnvVar;
		value: string | undefined;
	}

	let { variable, value = $bindable() }: Props = $props();
	let reveal = $state(false);

	const id = $derived(`var-${variable.name}`);
	const missing = $derived(variable.required && !value && !variable.default);
</script>

<div class="field">
	<label for={id}>
		<code>{variable.name}</code>
		{#if variable.required}<span class="req" title="required">required</span>{/if}
		{#if variable.secret}<span class="hint">secret, goes to .env</span>{/if}
	</label>
	<div class="input">
		<input
			{id}
			type={variable.secret && !reveal ? 'password' : 'text'}
			bind:value
			placeholder={variable.default || (variable.required ? '' : 'not set')}
			aria-invalid={missing}
			autocomplete="off"
			spellcheck="false"
		/>
		{#if variable.secret}
			<button type="button" class="reveal" onclick={() => (reveal = !reveal)}>{reveal ? 'Hide' : 'Show'}</button>
		{/if}
	</div>
	{#if variable.description}<small><Inline text={variable.description} /></small>{/if}
</div>

<style>
	.field {
		display: grid;
		gap: 0.25rem;
	}
	label {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: baseline;
	}
	.req {
		font-size: 0.75rem;
		color: var(--warn);
	}
	.hint {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.input {
		display: flex;
		gap: 0.4rem;
	}
	.reveal {
		flex: none;
	}
	input[aria-invalid='true'] {
		border-color: var(--warn-border);
		background: var(--warn-bg);
	}
	small {
		color: var(--muted);
	}
</style>
