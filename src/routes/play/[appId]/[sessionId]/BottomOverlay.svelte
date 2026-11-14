<script lang="ts">
	import type { QualityMode, QualityOption } from '#lib/playback/quality';
	import type { SubtitleTrack } from '#lib/playback/subtitles';
	import type { ChatMode } from '#lib/playback/chatMode';
	import LiveBadge from './LiveBadge.svelte';
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
		live,
		viewers,
		liveLatency,
		onGoLive,
		chatAvailable,
		chatMode,
		onChatMode,
		subtitleTracks,
		subtitleLanguage,
		qualities,
		quality,
		controls,
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
		/** Still broadcasting, shown as a badge where the progress bar would be. */
		live: boolean;
		viewers: number | null;
		liveLatency: number | null;
		onGoLive: () => void;
		chatAvailable: boolean;
		chatMode: ChatMode;
		onChatMode: (mode: ChatMode) => void;
		subtitleTracks: SubtitleTrack[];
		subtitleLanguage: string | null;
		qualities: readonly QualityOption[];
		quality: QualityOption | undefined;
		/** What the app allows for this stream, a hidden control leaves no gap. */
		controls: { seek: boolean; seekButtons: boolean; playPause: boolean; volume: boolean };
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
		<!-- Empty cell instead of nothing, so the transport controls stay centered. -->
		<div class="justify-self-start">
			{#if controls.volume}<VolumeControl bind:volume {locked} />{/if}
		</div>
		<TransportControls
			bind:playPauseButton
			{playing}
			{locked}
			showSeekButtons={controls.seekButtons}
			showPlayPause={controls.playPause}
			{onTogglePlay}
			{onSeekBy}
		/>
		<TrackPickers
			{subtitleTracks}
			{subtitleLanguage}
			{qualities}
			{quality}
			{modeFor}
			{locked}
			{chatAvailable}
			{chatMode}
			{onSubtitle}
			{onQuality}
			{onChatMode}
		/>
	</div>

	{#if live}
		<LiveBadge {viewers} latency={liveLatency} {locked} {onGoLive} />
	{:else if controls.seek}
		<ProgressBar {position} {duration} {locked} {onSeek} />
	{/if}
</div>
