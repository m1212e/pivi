<script lang="ts">
	import type { QualityMode, QualityOption } from '#lib/playback/quality';
	import type { SubtitleTrack } from '#lib/playback/subtitles';
	import ProgressBar from './ProgressBar.svelte';
	import TrackPickers from './TrackPickers.svelte';
	import TransportControls from './TransportControls.svelte';
	import VolumeControl from './VolumeControl.svelte';

	let {
		visible,
		locked,
		volume = $bindable(),
		playPauseButton = $bindable(),
		playing,
		position,
		duration,
		subtitleTracks,
		subtitleLanguage,
		quality,
		modeFor,
		onTogglePlay,
		onSeekBy,
		onSeek,
		onSubtitle,
		onQuality
	}: {
		visible: boolean;
		locked: boolean;
		volume: number;
		playPauseButton?: HTMLButtonElement;
		playing: boolean;
		position: number;
		duration: number;
		subtitleTracks: SubtitleTrack[];
		subtitleLanguage: string | null;
		quality: QualityOption;
		modeFor: (option: QualityOption) => QualityMode | undefined;
		onTogglePlay: () => void;
		onSeekBy: (deltaSeconds: number) => void;
		onSeek: (seconds: number) => void;
		onSubtitle: (language: string | null) => void;
		onQuality: (quality: QualityOption) => void;
	} = $props();
</script>

<!-- Faded instead of unmounted while idle so remote focus can still reach it
     and bring the UI back. -->
<div
	class="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-linear-to-t from-slate-950/90 via-slate-950/50 to-transparent px-6 pt-20 pb-3 transition-opacity duration-300 sm:px-10 {visible
		? 'opacity-100'
		: 'pointer-events-none opacity-0'}"
>
	<!-- Three grid tracks instead of flex, so the playback controls stay
	     centered whatever the side columns contain. -->
	<div class="grid grid-cols-3 items-end gap-6">
		<VolumeControl bind:volume {locked} />
		<TransportControls bind:playPauseButton {playing} {locked} {onTogglePlay} {onSeekBy} />
		<TrackPickers
			{subtitleTracks}
			{subtitleLanguage}
			{quality}
			{modeFor}
			{locked}
			{onSubtitle}
			{onQuality}
		/>
	</div>

	<ProgressBar {position} {duration} {locked} {onSeek} />
</div>
