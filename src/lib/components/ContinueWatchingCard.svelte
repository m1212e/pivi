<script lang="ts">
	// The one shelf with a 16:9 thumbnail and a watch-progress bar, kept
	// separate from PosterCard since it's a genuinely different shape rather
	// than a variant.
	let {
		title,
		subtitle,
		image,
		progress
	}: {
		title: string;
		subtitle: string;
		image: string;
		progress: number;
	} = $props();
</script>

<button
	type="button"
	class="group flex w-56 shrink-0 flex-col gap-2 text-left focus:outline-none sm:w-64"
>
	<!-- The glow lives on this wrapper rather than the image span itself,
	     since that span needs `overflow-hidden` to clip the image to its
	     rounded corners, which would also clip the glow bleeding outside it. -->
	<span class="pivi-card relative block" style="--pivi-glow: url({image})">
		<span
			data-focus-ring-target
			class="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl transition group-hover:scale-[1.03]"
		>
			<img src={image} alt="" class="size-full object-cover object-top" />
			<span class="absolute inset-x-0 bottom-0 h-1 bg-black/30" aria-hidden="true">
				<span class="block h-full bg-white" style="width: {Math.round(progress * 100)}%"></span>
			</span>
		</span>
	</span>
	<span class="truncate text-sm font-medium text-white/90">{title}</span>
	<span class="truncate text-xs text-white/50">{subtitle}</span>
</button>
