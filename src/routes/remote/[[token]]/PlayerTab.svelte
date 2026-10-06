<script lang="ts">
	import { fly } from 'svelte/transition';
	import {
		Captions,
		Gauge,
		Info,
		Layers,
		Pause,
		Play,
		RotateCcw,
		RotateCw,
		Server,
		Sparkles,
		Volume2,
		Zap
	} from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import Select from '#lib/components/Select.svelte';
	import Slider from '#lib/components/Slider.svelte';
	import type { RemoteController } from '#lib/pairing/remoteController.svelte';
	import { formatTime } from '#lib/playback/time';

	const QUALITY_MODE_ICON = { direct: Zap, mse: Layers, ffmpeg: Server } as const;

	let { remote }: { remote: RemoteController } = $props();

	const tv = $derived(remote.tv);

	// `null` (Off) always leads, same as the TV player's own list.
	const subtitleChoices = $derived<(string | null)[]>([
		null,
		...tv.subtitleTracks.map((t) => t.language)
	]);
	// The TV reports tiers ascending, but a picker reads best with the best on top.
	const qualityChoices = $derived(tv.qualityOptions.toReversed());

	// The sliders' displayed values. They track the TV while idle and take
	// over during a drag (see Slider's liveValue and onCommit props).
	let scrubPosition = $state(0);
	let scrubVolume = $state(0);

	const sideButtonClass =
		'flex size-16 items-center justify-center rounded-full bg-white/12 text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none';
</script>

<!-- onLight: this rendering sits on the expanded list's solid white selected
     row rather than the dark translucent trigger, which the icon needs for contrast. -->
{#snippet qualityOption(option: number, onLight: boolean)}
	{@const mode = tv.qualityModes[String(option)]}
	{@const ModeIcon = mode && QUALITY_MODE_ICON[mode]}
	<span>{option}p</span>
	{#if ModeIcon}
		<ModeIcon class="size-3.5 shrink-0 {onLight ? 'text-slate-950/70' : 'text-white/50'}" />
	{/if}
{/snippet}

{#snippet subtitleOption(language: string | null, onLight: boolean)}
	{@const track = tv.subtitleTracks.find((t) => t.language === language) ?? null}
	<span class="min-w-0 truncate">
		{track ? (track.label ?? track.language) : m.subtitles_off()}
	</span>
	{#if track?.kind === 'transcription'}
		<Sparkles class="size-3.5 shrink-0 {onLight ? 'text-amber-600' : 'text-amber-400'}" />
	{/if}
{/snippet}

<div class="flex w-full max-w-sm flex-col items-center gap-6">
	<div
		class="flex items-center justify-center gap-4"
		in:fly|global={{ y: 24, duration: 400, delay: 0 }}
	>
		<button
			type="button"
			onclick={() => remote.playerAction('seekBack')}
			aria-label={m.seek_back()}
			class={sideButtonClass}
		>
			<RotateCcw class="size-6" />
		</button>
		<button
			type="button"
			onclick={() => remote.playerAction('playPause')}
			aria-label={m.play_pause()}
			class="flex size-20 items-center justify-center rounded-full bg-white text-slate-950 shadow-lg transition hover:bg-white/90 focus:outline-none"
		>
			{#if tv.playing}
				<Pause class="size-8" fill="currentColor" />
			{:else}
				<Play class="size-8" fill="currentColor" />
			{/if}
		</button>
		<button
			type="button"
			onclick={() => remote.playerAction('seekForward')}
			aria-label={m.seek_forward()}
			class={sideButtonClass}
		>
			<RotateCw class="size-6" />
		</button>
	</div>

	<div class="flex w-full items-center gap-3" in:fly|global={{ y: 24, duration: 400, delay: 70 }}>
		<Volume2 class="size-5 shrink-0 text-white/60" aria-hidden="true" />
		<!-- The default ('md') size, deliberately thicker than the seek bar
		     below, since volume is the control most worth hitting without looking. -->
		<Slider
			bind:value={scrubVolume}
			liveValue={tv.volume}
			onChange={remote.setVolume}
			min={0}
			max={1}
			step={0.02}
			orientation="horizontal"
			label={m.volume()}
		/>
	</div>

	<div class="flex w-full items-center gap-3" in:fly|global={{ y: 24, duration: 400, delay: 140 }}>
		<span class="w-10 text-right text-xs text-white/60 tabular-nums">
			{formatTime(scrubPosition)}
		</span>
		<Slider
			bind:value={scrubPosition}
			liveValue={tv.position}
			onCommit={remote.seek}
			min={0}
			max={tv.duration}
			step={1}
			orientation="horizontal"
			label={m.seek()}
			sensitivity={1500}
			size="sm"
		/>
		<span class="w-10 text-xs text-white/60 tabular-nums">{formatTime(tv.duration)}</span>
	</div>

	{#if tv.qualityOptions.length > 0}
		<div
			class="flex flex-col items-center gap-2"
			in:fly|global={{ y: 24, duration: 400, delay: 210 }}
		>
			<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
				<Gauge class="size-4" />
				{m.quality()}
			</span>
			<!-- Collapsed rather than every option laid out flat, a phone's
			     width runs out well before a long option list does. -->
			<Select
				value={tv.quality}
				onChange={remote.selectQuality}
				options={qualityChoices}
				label={m.quality()}
				option={qualityOption}
			/>
		</div>
	{/if}

	<!-- Only once the TV has reported tracks. Most sessions have none, and an
	     Off-only picker would be noise for no real choice. -->
	{#if tv.subtitleTracks.length > 0}
		<div
			class="flex flex-col items-center gap-2"
			in:fly|global={{ y: 24, duration: 400, delay: 245 }}
		>
			<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
				<Captions class="size-4" />
				{m.subtitles()}
			</span>
			<Select
				value={tv.subtitleLanguage}
				onChange={remote.selectSubtitle}
				options={subtitleChoices}
				label={m.subtitles()}
				option={subtitleOption}
			/>
		</div>
	{/if}

	<button
		type="button"
		onclick={() => remote.playerAction('toggleInfo')}
		aria-label={m.info()}
		aria-pressed={tv.diagnosticsOpen}
		in:fly|global={{ y: 24, duration: 400, delay: 280 }}
		class="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium shadow-lg ring-1 shadow-black/20 backdrop-blur-2xl backdrop-saturate-150 transition focus:outline-none {tv.diagnosticsOpen
			? 'bg-white text-slate-950'
			: 'bg-white/12 text-white/80 ring-white/25 hover:bg-white/20'}"
	>
		<Info class="size-4" />
		{m.info()}
	</button>
</div>
