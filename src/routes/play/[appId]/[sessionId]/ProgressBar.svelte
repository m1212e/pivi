<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import Slider from '#lib/components/Slider.svelte';
	import { formatTime } from '#lib/playback/time';

	let {
		position,
		duration,
		locked,
		onSeek
	}: { position: number; duration: number; locked: boolean; onSeek: (seconds: number) => void } =
		$props();

	// Slider value. Follows position until the user drags.
	let scrubPosition = $state(0);
</script>

<div class="mx-auto flex w-full max-w-2xl items-center gap-3 sm:w-1/2">
	<span class="w-10 text-right text-xs text-white/60 tabular-nums">
		{formatTime(scrubPosition)}
	</span>
	<Slider
		bind:value={scrubPosition}
		liveValue={position}
		onCommit={onSeek}
		min={0}
		max={duration}
		step={1}
		orientation="horizontal"
		label={m.seek()}
		sensitivity={1500}
		size="sm"
		disabled={locked}
	/>
	<span class="w-10 text-xs text-white/60 tabular-nums">{formatTime(duration)}</span>
</div>
