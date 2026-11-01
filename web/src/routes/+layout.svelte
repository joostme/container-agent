<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>fitout configurator</title>
	<meta name="description" content="Fit out a container: pick tools, apps and services from the catalog and get a ready compose.yaml." />
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		color-scheme: light dark;
		--bg: #f6f7f9;
		--surface: #ffffff;
		--surface-2: #f0f2f5;
		--border: #d9dde3;
		--text: #1c2128;
		--muted: #5c6672;
		--accent: #2f6fde;
		--accent-soft: #e5eefc;
		--warn: #8a5a00;
		--warn-bg: #fff4d6;
		--warn-border: #f0d48a;
		--ok: #1f7a3d;
		--radius: 10px;
		--mono: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--bg: #12151a;
			--surface: #1a1e24;
			--surface-2: #222730;
			--border: #313844;
			--text: #e4e8ee;
			--muted: #98a2ae;
			--accent: #6ea2ff;
			--accent-soft: #1d2b44;
			--warn: #f2c35b;
			--warn-bg: #2e2612;
			--warn-border: #5c4a1c;
			--ok: #5cc581;
		}
	}
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font:
			15px/1.5 system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
	}
	:global(code),
	:global(pre),
	:global(kbd) {
		font-family: var(--mono);
		font-size: 0.9em;
	}
	:global(a) {
		color: var(--accent);
	}
	:global(input),
	:global(select),
	:global(textarea),
	:global(button) {
		font: inherit;
		color: inherit;
	}
	:global(input[type='text']),
	:global(input[type='password']),
	:global(input:not([type])),
	:global(select),
	:global(textarea) {
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface);
	}
	:global(input:focus-visible),
	:global(select:focus-visible),
	:global(textarea:focus-visible),
	:global(button:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	:global(button) {
		cursor: pointer;
		padding: 0.45rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface);
	}
	:global(button:hover) {
		background: var(--surface-2);
	}
	:global(button.primary) {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	:global(button.primary:hover) {
		filter: brightness(1.08);
	}
</style>
