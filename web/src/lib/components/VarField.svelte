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
	const checked = $derived((value || variable.default) === 'true');
</script>

<div class="field">
	<label for={id}>
		<code>{variable.name}</code>
		{#if variable.required}<span class="req">required</span>{/if}
		{#if variable.type === 'secret'}<span class="hint">secret, goes to .env</span>{/if}
		{#if variable.type === 'port'}<span class="hint">{variable.protocol ?? 'tcp'} port, published</span>{/if}
	</label>
	{#if variable.type === 'choice'}
		<select {id} bind:value>
			<option value="">{variable.default ? `default (${variable.default})` : 'not set'}</option>
			{#each variable.choices as choice (choice)}
				<option value={choice}>{choice}</option>
			{/each}
		</select>
	{:else if variable.type === 'bool'}
		<label class="switch">
			<input
				{id}
				type="checkbox"
				{checked}
				onchange={(e) => (value = e.currentTarget.checked ? 'true' : 'false')}
			/>
			{checked ? 'on' : 'off'}
		</label>
	{:else}
		<div class="input">
			<input
				{id}
				type={variable.type === 'secret' && !reveal ? 'password' : 'text'}
				inputmode={variable.type === 'port' ? 'numeric' : undefined}
				bind:value
				placeholder={variable.default || (variable.required ? '' : 'not set')}
				aria-invalid={missing}
				autocomplete="off"
				spellcheck="false"
			/>
			{#if variable.type === 'secret'}
				<button type="button" class="reveal" onclick={() => (reveal = !reveal)}>{reveal ? 'Hide' : 'Show'}</button>
			{/if}
		</div>
	{/if}
	{#if variable.description}<small><Inline text={variable.description} /></small>{/if}
</div>

<style>
	.field {
		display: grid;
		gap: 0.25rem;
		align-content: start;
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
	.switch {
		align-items: center;
		padding: 0.3rem 0;
	}
	.switch input {
		width: 1.05rem;
		height: 1.05rem;
		accent-color: var(--accent);
	}
	input[aria-invalid='true'] {
		border-color: var(--warn-border);
		background: var(--warn-bg);
	}
	small {
		color: var(--muted);
	}
</style>
