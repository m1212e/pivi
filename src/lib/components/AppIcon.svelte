<script lang="ts">
	import type { Snippet } from 'svelte';
	import { appAccentGradient } from '#lib/appAccent';
	import { appIconDataUrl } from '#lib/apps/manifest';

	// An app's tile: its own accent gradient with its icon, or its first letter
	// when it has none. Size comes from `class` (e.g. `size-12`), and anything
	// extra (a focus ring target, a glow, a badge via `children`) is the
	// caller's, so the dashboard tile and the app's page header share one look.
	let {
		id,
		name,
		icon = null,
		primaryColor = null,
		secondaryColor = null,
		iconClass = 'size-10',
		class: extra = '',
		style = '',
		children,
		...rest
	}: {
		id: string;
		name: string;
		icon?: string | null;
		primaryColor?: string | null;
		secondaryColor?: string | null;
		// Size of the icon image inside the tile.
		iconClass?: string;
		class?: string;
		style?: string;
		children?: Snippet;
		[key: `data-${string}`]: string | boolean | undefined;
	} = $props();

	const gradient = $derived(appAccentGradient(id, primaryColor, secondaryColor));
</script>

<span
	{...rest}
	class="relative flex shrink-0 items-center justify-center rounded-2xl text-lg font-semibold text-white/90 uppercase {extra}"
	style="background: {gradient}; --pivi-glow: {gradient}; {style}"
>
	{#if icon}
		<img src={appIconDataUrl(icon)} alt="" class="{iconClass} object-contain" />
	{:else}
		{name.slice(0, 1)}
	{/if}
	{@render children?.()}
</span>
