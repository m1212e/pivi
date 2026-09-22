<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import heroPlaceholder from '#lib/assets/heroPlaceholder.svg';

	// Shown instead of HeroBanner when no app has contributed a single card
	// yet -- a fresh login with nothing configured, not "still loading" (the
	// dashboard query is awaited before the page ever renders, so an empty
	// result here is final, not a loading flash). Matches HeroBanner's exact
	// dimensions so nothing jumps once real content starts arriving.
</script>

<div
	class="relative h-[52vh] min-h-80 w-full overflow-hidden sm:h-[60vh]"
	transition:fade={{ duration: 400 }}
>
	<img src={heroPlaceholder} alt="" class="size-full object-cover object-top" />

	<div class="absolute inset-0 bg-linear-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
	<div
		class="absolute inset-0 bg-linear-to-r from-slate-950/80 via-slate-950/10 to-transparent"
	></div>

	<div
		class="absolute inset-x-0 bottom-0 flex flex-col gap-4 px-8 pb-10 sm:px-12 sm:pb-14"
		in:fly={{ y: 28, duration: 500, delay: 100 }}
	>
		<h1 class="max-w-2xl text-3xl font-semibold text-white sm:text-5xl">No content yet</h1>
		<p class="max-w-xl text-sm text-white/70 sm:text-base">
			Sign in to one of your apps and your recommendations will show up right here.
		</p>
	</div>
</div>
