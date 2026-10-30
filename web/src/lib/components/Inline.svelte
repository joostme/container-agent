<script lang="ts">
	// Text with `code` spans, as in module descriptions
	let { text }: { text: string } = $props();
	const parts = $derived(text.split(/(`[^`]+`)/).filter(Boolean));
</script>

{#each parts as part, i (i)}{#if part.startsWith('`')}<code>{part.slice(1, -1)}</code>{:else}{part}{/if}{/each}
