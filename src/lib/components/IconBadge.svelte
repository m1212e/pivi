<script lang="ts">
	// Lets sandboxed apps show an icon through UiNodeRenderer without shipping
	// image assets. They send the `d` of a single 24x24 SVG path.
	let { path, size = 'normal' }: { path: string; size?: 'normal' | 'large' } = $props();
</script>

<span
	class="flex shrink-0 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/15 {size ===
	'large'
		? 'size-24'
		: 'size-16'}"
>
	<svg
		viewBox="0 0 24 24"
		class="fill-white/90 {size === 'large' ? 'size-16' : 'size-8'}"
		aria-hidden="true"
	>
		<path d={path} />
	</svg>
</span>
