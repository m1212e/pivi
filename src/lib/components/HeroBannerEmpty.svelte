<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import { fade, fly } from 'svelte/transition';
	import heroPlaceholder from '#lib/assets/heroPlaceholder.svg';

	// Home's hero when no app has contributed a card yet, like a fresh login.
	// Separate from HeroBannerSkeleton since this state is final, not loading.
	// Matches HeroBanner's dimensions so nothing jumps once content arrives.
</script>

<div
	class="relative h-[52vh] min-h-80 w-full overflow-hidden sm:h-[60vh]"
	transition:fade={{ duration: 400 }}
>
	<div class="absolute inset-0 mask-b-from-55% mask-b-to-100%">
		<img src={heroPlaceholder} alt="" class="size-full object-cover object-top" />

		<div
			class="absolute inset-0 bg-linear-to-t from-slate-950 via-slate-950/40 to-transparent"
		></div>
		<div
			class="absolute inset-0 bg-linear-to-r from-slate-950/80 via-slate-950/10 to-transparent"
		></div>
	</div>

	<div
		class="absolute inset-x-0 bottom-0 flex flex-col gap-4 px-8 pb-10 sm:px-12 sm:pb-14"
		in:fly={{ y: 28, duration: 500, delay: 100 }}
	>
		<h1 class="max-w-2xl text-3xl font-semibold text-white sm:text-5xl">{m.hero_empty_title()}</h1>
		<p class="max-w-xl text-sm text-white/70 sm:text-base">
			{m.hero_empty_description()}
		</p>
	</div>
</div>
