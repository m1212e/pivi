<script lang="ts">
	// The one media card: a thumbnail with a title and a meta line underneath.
	// Video shelves, poster shelves, continue-watching rows and an app's own
	// grids all configure this, so a size or text change is one edit.
	//
	// Either a link (`href`) or a button (`onSelect`, for a card that changes the
	// screen it is on instead of navigating, like an app's playlist card).
	let {
		title,
		meta,
		image,
		shape = 'video',
		stacked = false,
		href,
		onSelect,
		badge,
		progress
	}: {
		title: string;
		meta: string;
		image: string;
		// 16:9 thumbnails or 2:3 posters.
		shape?: 'video' | 'poster' | 'avatar';
		// A pile of cards behind the thumbnail, to tell a playlist from a video.
		stacked?: boolean;
		href?: string;
		onSelect?: () => void;
		// A short label on the thumbnail's bottom-right corner, e.g. a duration.
		badge?: string;
		// 0..1 watch progress, drawn as a bar along the thumbnail's bottom edge.
		progress?: number;
	} = $props();

	const WIDTH = {
		video: 'w-72 sm:w-80',
		poster: 'w-40 sm:w-48',
		// The same cell as a video, so a grid keeps its columns.
		avatar: 'w-72 sm:w-80'
	};
	const ASPECT = {
		video: 'aspect-video rounded-xl',
		poster: 'aspect-2/3 rounded-xl',
		avatar: 'aspect-square rounded-full'
	};
	const classes = $derived(
		`group flex ${WIDTH[shape]} shrink-0 flex-col gap-2 focus:outline-none ${shape === 'avatar' ? 'items-center text-center' : 'text-left'}`
	);

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

{#snippet content()}
	<!-- The glow lives on this wrapper rather than the image span itself,
	     since that span needs `overflow-hidden` to clip the image to its
	     rounded corners, which would also clip the glow bleeding outside it. -->
	<span
		class="pivi-card relative block {shape === 'avatar' ? 'mx-auto w-44 sm:w-52' : ''}"
		style="--pivi-glow: url({image})"
	>
		{#if stacked}
			<span class="absolute inset-x-4 -top-2 h-3 rounded-t-xl bg-white/30" aria-hidden="true"
			></span>
			<span class="absolute inset-x-8 -top-4 h-3 rounded-t-xl bg-white/15" aria-hidden="true"
			></span>
		{/if}
		<span
			data-focus-ring-target
			class="relative flex {ASPECT[
				shape
			]} items-center justify-center overflow-hidden transition group-hover:scale-[1.03]"
		>
			{#if image}
				<img
					src={image}
					alt=""
					referrerpolicy="no-referrer"
					onerror={onImageError}
					class="size-full object-cover {shape === 'poster' ? 'object-top' : ''}"
				/>
			{:else}
				<span class="size-full bg-white/10"></span>
			{/if}
			{#if badge}
				<span
					class="absolute right-1 bottom-1 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white"
				>
					{badge}
				</span>
			{/if}
			{#if progress !== undefined}
				<span class="absolute inset-x-0 bottom-0 h-1 bg-black/30" aria-hidden="true">
					<span class="block h-full bg-white" style="width: {Math.round(progress * 100)}%"></span>
				</span>
			{/if}
		</span>
	</span>
	<span class="w-full truncate text-base font-medium text-white/90">{title}</span>
	<span class="w-full truncate text-sm text-white/50">{meta}</span>
{/snippet}

{#if href}
	<a {href} class={classes}>
		{@render content()}
	</a>
{:else}
	<button type="button" onclick={onSelect} class={classes}>
		{@render content()}
	</button>
{/if}
