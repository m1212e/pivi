<script lang="ts">
	import { Check } from '@lucide/svelte';
	import type { SkipSegment } from '#lib/playback/skipSegments';

	let {
		segment,
		skipActive,
		onToggle
	}: { segment: SkipSegment | null; skipActive: boolean; onToggle: () => void } = $props();
</script>

<!-- Not locked and outside the fading container, since a skip is coming
     whether or not the rest of the UI is visible. Offsets are fixed because
     it has to hold its spot while the row below is faded out. -->
{#if segment}
	<div class="absolute right-40 bottom-16 z-10 sm:right-48 sm:bottom-20">
		<button
			type="button"
			onclick={onToggle}
			role="checkbox"
			aria-checked={skipActive}
			class="flex items-center gap-2 rounded-full bg-white/12 px-4 py-2.5 text-sm font-medium text-white shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
		>
			<span
				class="flex size-4 items-center justify-center rounded ring-1 ring-white/50 {skipActive
					? 'bg-white text-slate-950'
					: 'bg-transparent text-transparent'}"
			>
				<Check class="size-3" />
			</span>
			Skip active{segment.label ? ` (${segment.label})` : ''}
		</button>
	</div>
{/if}
