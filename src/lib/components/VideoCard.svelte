<script lang="ts">
	// Kept separate from PosterCard (2:3) since video thumbnails are 16:9 —
	// a genuinely different shape, not a variant.
	let {
		title,
		meta,
		image,
		href
	}: {
		title: string;
		meta: string;
		image: string;
		href: string;
	} = $props();

	// maxresdefault (the highest-res YouTube thumbnail) 404s for videos with
	// no high-res source — degrade to mqdefault (always generated) rather
	// than showing a broken image.
	function onImageError(event: Event) {
		const img = event.currentTarget as HTMLImageElement;
		if (img.src.includes('maxresdefault.jpg')) {
			img.src = img.src.replace('maxresdefault.jpg', 'mqdefault.jpg');
		}
	}
</script>

<a {href} class="group flex w-56 shrink-0 flex-col gap-2 text-left focus:outline-none sm:w-64">
	<!-- The glow lives on this wrapper rather than the image span itself,
	     since that span needs `overflow-hidden` to clip the image to its
	     rounded corners, which would also clip the glow bleeding outside it. -->
	<span class="pivi-card relative block" style="--pivi-glow: url({image})">
		<span
			data-focus-ring-target
			class="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl transition group-hover:scale-[1.03]"
		>
			<img src={image} alt="" onerror={onImageError} class="size-full object-cover" />
		</span>
	</span>
	<span class="truncate text-sm font-medium text-white/90">{title}</span>
	<span class="truncate text-xs text-white/50">{meta}</span>
</a>
