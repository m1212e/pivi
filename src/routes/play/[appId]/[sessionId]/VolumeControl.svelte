<script lang="ts">
	import { Volume2 } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import Slider from '#lib/components/Slider.svelte';

	let { volume = $bindable(), locked }: { volume: number; locked: boolean } = $props();
</script>

<div class="flex flex-col items-center gap-2 justify-self-start">
	<span class="text-xs text-white/60 tabular-nums">{Math.round(volume * 100)}%</span>
	<Slider
		bind:value={volume}
		min={0}
		max={1}
		step={0.005}
		orientation="vertical"
		label={m.volume()}
		sensitivity={600}
		disabled={locked}
	/>
	<Volume2 class="size-5 text-white/70" />
</div>
