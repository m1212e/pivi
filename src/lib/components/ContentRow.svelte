<script lang="ts">
	import type { Snippet } from 'svelte';
	import { inview } from 'svelte-inview';

	// Generic horizontal shelf shared by every dashboard row (continue watching,
	// apps, future recommendation rows) so scroll/keyboard behavior only lives
	// in one place.
	let {
		title,
		children
	}: {
		title: string;
		children: Snippet;
	} = $props();

	// Rows only unfold their cards the first time they scroll into view,
	// rather than immediately on mount — a row further down the dashboard
	// shouldn't reveal itself before the user has scrolled anywhere near it.
	// `unobserveOnEnter` means this only ever fires once per row, so
	// scrolling away and back doesn't replay it.
	let revealed = $state(false);
</script>

<!-- `data-pivi-row` lets RemoteBridge's spatial nav center this whole row
     (title included) in the viewport when one of its cards is selected. -->
<section
	class="flex flex-col gap-4"
	data-pivi-row
	use:inview={{ rootMargin: '-10%', unobserveOnEnter: true }}
	oninview_change={(event) => {
		if (event.detail.inView) revealed = true;
	}}
>
	<h2 class="pivi-row-title px-8 text-xl font-semibold text-white/90 sm:px-12">
		{title}
	</h2>
	<!-- `overflow-x-auto` computes `overflow-y` to `auto` too (per spec, once
	     one axis isn't `visible`), which clips anything a card renders past
	     its own box — the selection ring's `outline-offset`, its hover scale,
	     and `.pivi-card`'s glow. `py-10` and `gap-10` give the glow room to
	     spread into on every side without touching a neighboring card or
	     getting cut off by the row's own edge.

	     `data-pivi-hscroll` lets RemoteBridge recognize this as a horizontally
	     scrolling shelf, so selecting its first/last card scrolls all the way
	     to that edge instead of just far enough to bring the card into view. -->
	<div
		data-pivi-hscroll
		class="pivi-row-fade flex scrollbar-none gap-10 overflow-x-auto px-8 py-10 sm:px-12"
	>
		{#if revealed}
			{@render children()}
		{/if}
	</div>
</section>
