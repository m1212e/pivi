<script lang="ts">
	// Stands in for VideoCard when an app hasn't produced any real cards yet
	// -- same footprint, a color fade instead of a thumbnail, and a title
	// that explains why the slot is empty instead of a video title.
	let {
		title,
		gradient,
		href
	}: {
		title: string;
		gradient: string;
		href: string;
	} = $props();
</script>

<a {href} class="group flex w-56 shrink-0 flex-col gap-2 text-left focus:outline-none sm:w-64">
	<span class="pivi-card relative block" style="--pivi-glow: {gradient}">
		<span
			data-focus-ring-target
			class="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl p-4 text-center transition group-hover:scale-[1.03]"
			style="background: {gradient}"
		>
			<span class="text-sm font-medium text-white/90">{title}</span>
		</span>
	</span>
</a>
