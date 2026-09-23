<script lang="ts">
	import { fade, fly } from 'svelte/transition';

	let {
		title,
		description,
		badge,
		source,
		gradient,
		image,
		href
	}: {
		title: string;
		description: string;
		badge?: string;
		// Which app/plugin this suggestion came from — generic over whatever
		// contributed the card, not specific to any one of them.
		source?: string;
		gradient?: string;
		image?: string;
		href: string;
	} = $props();

	// maxresdefault (the highest-res YouTube thumbnail) 404s for videos with
	// no high-res source — degrade to mqdefault (always generated, still a
	// genuine 16:9 crop with no letterbox) rather than showing a broken image.
	function onImageError(event: Event) {
		const img = event.currentTarget as HTMLImageElement;
		if (img.src.includes('maxresdefault.jpg')) {
			img.src = img.src.replace('maxresdefault.jpg', 'mqdefault.jpg');
		}
	}
</script>

<div
	class="relative h-[52vh] min-h-80 w-full overflow-hidden sm:h-[60vh]"
	transition:fade={{ duration: 400 }}
>
	<div class="absolute inset-0 bg-slate-800" style:background={gradient}>
		{#if image}
			<img src={image} alt="" onerror={onImageError} class="size-full object-cover object-top" />
		{/if}
	</div>

	<!-- Fades the artwork into the page background so the row below reads as
	     one continuous surface rather than a hard-edged banner. -->
	<div class="absolute inset-0 bg-linear-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
	<div
		class="absolute inset-0 bg-linear-to-r from-slate-950/80 via-slate-950/10 to-transparent"
	></div>

	<div
		class="absolute inset-x-0 bottom-0 flex flex-col gap-4 px-8 pb-10 sm:px-12 sm:pb-14"
		in:fly={{ y: 28, duration: 500, delay: 100 }}
	>
		{#if badge || source}
			<div class="flex items-center gap-2">
				{#if badge}
					<span class="text-sm font-medium tracking-wide text-white/60 uppercase">{badge}</span>
				{/if}
				{#if badge && source}
					<span class="text-white/30" aria-hidden="true">&middot;</span>
				{/if}
				{#if source}
					<span
						class="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/60 ring-1 ring-white/15"
					>
						{source}
					</span>
				{/if}
			</div>
		{/if}
		<h1 class="max-w-2xl text-3xl font-semibold text-white sm:text-5xl">{title}</h1>
		<p class="max-w-xl text-sm text-white/70 sm:text-base">{description}</p>

		<div class="mt-2 flex gap-3" in:fly={{ y: 20, duration: 450, delay: 260 }}>
			<a
				{href}
				class="flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-white/90 focus:outline-none sm:text-base"
			>
				<svg viewBox="0 0 24 24" fill="currentColor" class="size-5">
					<path d="M8 5v14l11-7z" />
				</svg>
				Play
			</a>
		</div>
	</div>
</div>
