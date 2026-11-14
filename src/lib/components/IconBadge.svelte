<script lang="ts">
	// Lets sandboxed apps show an icon through UiNodeRenderer without shipping
	// image assets: a host icon name or the `d` of a 24x24 path (@pivi/sdk/icons).
	import AppIcon from '#lib/components/apps/AppIcon.svelte';
	import type { IconRef } from '@pivi/sdk/icons';

	let { path, size = 'normal' }: { path: IconRef; size?: 'normal' | 'large' } = $props();
</script>

<span
	class="flex shrink-0 items-center justify-center rounded-full bg-white/12 text-white/90 ring-1 ring-white/15 {size ===
	'large'
		? 'size-24'
		: 'size-16'}"
>
	<AppIcon icon={path} class={size === 'large' ? 'size-16' : 'size-8'} />
</span>
