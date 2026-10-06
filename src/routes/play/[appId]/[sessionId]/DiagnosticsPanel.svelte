<script lang="ts">
	import type { Diagnostics } from '#lib/playback/diagnostics.svelte';
	import type { QualityMeta, QualityOption } from '#lib/playback/quality';
	import type { PlaybackMode } from '#lib/playback/engine.svelte';

	const READY_STATE_LABELS = [
		'HAVE_NOTHING',
		'HAVE_METADATA',
		'HAVE_CURRENT_DATA',
		'HAVE_FUTURE_DATA',
		'HAVE_ENOUGH_DATA'
	];
	const NETWORK_STATE_LABELS = [
		'NETWORK_EMPTY',
		'NETWORK_IDLE',
		'NETWORK_LOADING',
		'NETWORK_NO_SOURCE'
	];

	let {
		mode,
		quality,
		meta,
		snapshot,
		position,
		duration,
		buffering,
		lastFallbackReason
	}: {
		mode: PlaybackMode;
		quality: QualityOption;
		meta: QualityMeta | undefined;
		snapshot: Diagnostics;
		position: number;
		duration: number;
		buffering: boolean;
		lastFallbackReason: string | null;
	} = $props();

	const rows = $derived<[label: string, value: string][]>([
		['mode', mode],
		['quality', `${quality}p`],
		['direct', String(meta?.direct ?? '—')],
		['vcodec', meta?.vcodec ?? '—'],
		['acodec', meta?.acodec ?? '—'],
		['resolution', snapshot.resolution],
		['readyState', `${snapshot.readyState} (${READY_STATE_LABELS[snapshot.readyState]})`],
		['networkState', `${snapshot.networkState} (${NETWORK_STATE_LABELS[snapshot.networkState]})`],
		['buffered ahead', `${snapshot.bufferedAheadSeconds.toFixed(1)}s`],
		['position', `${position.toFixed(1)} / ${duration.toFixed(1)}`],
		['buffering', String(buffering)]
	]);

	const shakaRows = $derived.by<[label: string, value: string][]>(() => {
		const stats = snapshot.shakaStats;
		if (mode !== 'mse' || !stats) return [];
		return [
			['bandwidth (est.)', `${Math.round(stats.estimatedBandwidth / 1000)} kbps`],
			['stream bandwidth', `${Math.round(stats.streamBandwidth / 1000)} kbps`],
			['downloaded', `${(stats.bytesDownloaded / 1_000_000).toFixed(2)} MB`],
			['decoded / dropped', `${stats.decodedFrames} / ${stats.droppedFrames}`],
			['buffering time', `${stats.bufferingTime.toFixed(1)}s`],
			['stalls', String(stats.stallsDetected)]
		];
	});
</script>

{#snippet grid(entries: [label: string, value: string][])}
	<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
		{#each entries as [label, value] (label)}
			<span class="text-white/50">{label}</span>
			<span>{value}</span>
		{/each}
	</div>
{/snippet}

<div
	class="mt-4 max-w-sm rounded-2xl bg-white/12 p-4 font-mono text-xs text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150"
>
	{@render grid(rows)}

	{#if lastFallbackReason}
		<div class="mt-3 border-t border-white/15 pt-3">
			<p class="text-white/50">last fallback reason</p>
			<p class="break-words text-amber-300">{lastFallbackReason}</p>
		</div>
	{/if}

	{#if shakaRows.length > 0}
		<div class="mt-3 border-t border-white/15 pt-3">
			<p class="mb-1 text-white/50">shaka player</p>
			{@render grid(shakaRows)}
		</div>
	{/if}
</div>
