<script lang="ts">
	// Matches MediaCard's exact dimensions so a shelf doesn't reflow once the
	// real cards arrive.
	let { shape = 'video' }: { shape?: 'video' | 'poster' | 'avatar' } = $props();
</script>

<div
	class="flex shrink-0 flex-col gap-2 {shape === 'poster'
		? 'w-40 sm:w-48'
		: 'w-72 sm:w-80'} {shape === 'avatar' ? 'items-center' : ''}"
>
	{#if shape === 'avatar'}
		<div class="aspect-square w-44 animate-pulse rounded-full bg-white/10 sm:w-52"></div>
		<div class="h-5 w-1/2 animate-pulse rounded bg-white/10"></div>
		<div class="h-4 w-1/3 animate-pulse rounded bg-white/10"></div>
	{:else}
		<div
			class="{shape === 'poster'
				? 'aspect-2/3'
				: 'aspect-video'} animate-pulse rounded-xl bg-white/10"
		></div>
		<div class="h-5 w-3/4 animate-pulse rounded bg-white/10"></div>
		<div class="h-4 w-1/2 animate-pulse rounded bg-white/10"></div>
	{/if}
</div>
