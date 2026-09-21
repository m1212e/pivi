<script lang="ts">
	// Shared by every 2:3 poster shelf (trending, "because you watched", new
	// releases) so the card markup only lives in one place.
	let {
		title,
		meta,
		image
	}: {
		title: string;
		meta: string;
		image: string;
	} = $props();
</script>

<button
	type="button"
	class="group flex w-40 shrink-0 flex-col gap-2 text-left focus:outline-none sm:w-48"
>
	<!-- The glow lives on this wrapper rather than the image span itself,
	     since that span needs `overflow-hidden` to clip the image to its
	     rounded corners, which would also clip the glow bleeding outside it. -->
	<span class="pivi-card relative block" style="--pivi-glow: url({image})">
		<span
			data-focus-ring-target
			class="relative flex aspect-2/3 items-center justify-center overflow-hidden rounded-xl transition group-hover:scale-[1.03]"
		>
			<img src={image} alt="" class="size-full object-cover object-top" />
		</span>
	</span>
	<span class="truncate text-sm font-medium text-white/90">{title}</span>
	<span class="truncate text-xs text-white/50">{meta}</span>
</button>
