<script lang="ts">
	import { Pause, Play, RotateCcw, RotateCw } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import { SEEK_STEP_SECONDS } from '#lib/playback/seek';

	let {
		playing,
		locked,
		playPauseButton = $bindable(),
		onTogglePlay,
		onSeekBy
	}: {
		playing: boolean;
		locked: boolean;
		/** The one control that stays usable while locked, so it also takes focus when the rest hides. */
		playPauseButton?: HTMLButtonElement;
		onTogglePlay: () => void;
		onSeekBy: (deltaSeconds: number) => void;
	} = $props();

	const sideButtonClass =
		'flex items-center gap-1 rounded-full bg-white/12 px-4 py-3 text-xs font-medium text-white/90 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none';
</script>

<div class="flex flex-wrap items-center justify-center gap-3 justify-self-center">
	<button
		type="button"
		onclick={() => onSeekBy(-SEEK_STEP_SECONDS)}
		disabled={locked}
		aria-label={m.seek_back()}
		class={sideButtonClass}
	>
		<RotateCcw class="size-5" />
		{SEEK_STEP_SECONDS}
	</button>
	<button
		bind:this={playPauseButton}
		type="button"
		onclick={onTogglePlay}
		aria-label={playing ? m.pause() : m.play()}
		class="rounded-full bg-white p-3 text-slate-950 shadow-lg transition hover:bg-white/90 focus:outline-none"
	>
		{#if playing}
			<Pause class="size-5" fill="currentColor" />
		{:else}
			<Play class="size-5" fill="currentColor" />
		{/if}
	</button>
	<button
		type="button"
		onclick={() => onSeekBy(SEEK_STEP_SECONDS)}
		disabled={locked}
		aria-label={m.seek_forward()}
		class={sideButtonClass}
	>
		{SEEK_STEP_SECONDS}
		<RotateCw class="size-5" />
	</button>
</div>
