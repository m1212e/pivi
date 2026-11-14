<script lang="ts">
	import { Radio } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import { isBehindLive, viewersLabel } from '#lib/playback/live';
	import { formatTime } from '#lib/playback/time';

	let {
		viewers,
		latency,
		locked,
		onGoLive
	}: {
		/** From the app, null until known or when it doesn't report one. */
		viewers: number | null;
		/** Seconds behind the live edge, null before playback knows. */
		latency: number | null;
		locked: boolean;
		onGoLive: () => void;
	} = $props();

	const behind = $derived(isBehindLive(latency));
	const viewerText = $derived(viewersLabel(viewers));
</script>

<div class="flex items-center justify-center gap-3">
	{#if behind}
		<!-- How far behind sits inside the button, as what pressing it makes up. -->
		<button
			type="button"
			onclick={onGoLive}
			disabled={locked}
			class="flex items-center gap-2 rounded-full bg-red-600 py-1.5 pr-1.5 pl-4 text-xs font-semibold tracking-wide text-white uppercase shadow-lg transition hover:bg-red-500 focus:ring-2 focus:ring-white focus:outline-none"
		>
			<Radio class="size-4" />
			{m.jump_to_live()}
			<span class="rounded-full bg-black/25 px-2 py-0.5 tracking-normal tabular-nums">
				-{formatTime(latency ?? 0)}
			</span>
		</button>
	{:else}
		<span
			class="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold tracking-wide text-white shadow-lg"
		>
			<span class="size-2 rounded-full bg-white"></span>
			<span class="uppercase">{m.live()}</span>
			{#if viewerText}
				<span class="font-medium normal-case opacity-90">· {viewerText}</span>
			{/if}
		</span>
	{/if}
</div>
