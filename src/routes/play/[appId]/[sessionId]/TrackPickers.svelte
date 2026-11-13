<script lang="ts">
	import { Captions, Gauge, Layers, Server, Sparkles, Zap } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import Select from '#lib/components/Select.svelte';
	import type { QualityMode, QualityOption } from '#lib/playback/quality';
	import { subtitleOptions, type SubtitleTrack } from '#lib/playback/subtitles';

	let {
		subtitleTracks,
		subtitleLanguage,
		qualities,
		quality,
		modeFor,
		locked,
		onSubtitle,
		onQuality
	}: {
		subtitleTracks: SubtitleTrack[];
		/** null means captions off. */
		subtitleLanguage: string | null;
		/** Tiers the app offers, highest first. One or none is no choice, so the picker hides. */
		qualities: readonly QualityOption[];
		quality: QualityOption | undefined;
		modeFor: (option: QualityOption) => QualityMode | undefined;
		locked: boolean;
		onSubtitle: (language: string | null) => void;
		onQuality: (quality: QualityOption) => void;
	} = $props();

	const subtitleChoices = $derived(subtitleOptions(subtitleTracks));
</script>

<!-- onLight: this rendering sits on the selected row's white background. -->
{#snippet qualityOption(opt: QualityOption, onLight: boolean)}
	{@const mode = modeFor(opt)}
	<span>{opt}p</span>
	{#if mode === 'direct'}
		<span title={m.quality_mode_direct()}>
			<Zap class="size-4 {onLight ? 'text-emerald-600' : 'text-emerald-400'}" />
		</span>
	{:else if mode === 'mse'}
		<span title={m.quality_mode_mse()}>
			<Layers class="size-4 {onLight ? 'text-sky-600' : 'text-sky-400'}" />
		</span>
	{:else if mode === 'ffmpeg'}
		<span title={m.quality_mode_ffmpeg()}>
			<Server class="size-4 {onLight ? 'text-amber-600' : 'text-amber-400'}" />
		</span>
	{/if}
{/snippet}

{#snippet subtitleOption(language: string | null, onLight: boolean)}
	{@const track = subtitleTracks.find((t) => t.language === language) ?? null}
	<span class="min-w-0 truncate">{track ? (track.label ?? track.language) : m.subtitles_off()}</span
	>
	{#if track?.kind === 'transcription'}
		<span title={m.subtitles_auto_generated()}>
			<Sparkles class="size-4 shrink-0 {onLight ? 'text-amber-600' : 'text-amber-400'}" />
		</span>
	{/if}
{/snippet}

<!-- One column so the group's width, and the centering of the transport
     controls next to it, doesn't depend on whether the subtitle picker shows. -->
<div class="flex flex-col items-center gap-3 justify-self-end">
	<!-- A Select since caption tracks can run into the dozens. Hidden without
	     tracks, an Off-only picker is no choice. -->
	{#if subtitleTracks.length > 0}
		<div class="flex flex-col items-center gap-2">
			<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
				<Captions class="size-4" />
				Subtitles
			</span>
			<Select
				value={subtitleLanguage}
				onChange={onSubtitle}
				options={subtitleChoices}
				label={m.subtitles()}
				disabled={locked}
				option={subtitleOption}
			/>
		</div>
	{/if}

	{#if qualities.length > 1}
		<div class="flex flex-col items-center gap-2">
			<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
				<Gauge class="size-4" />
				Quality
			</span>
			<Select
				value={quality ?? qualities[0]}
				onChange={onQuality}
				options={qualities}
				label={m.quality()}
				disabled={locked}
				option={qualityOption}
			/>
		</div>
	{/if}
</div>
