<script lang="ts">
	import { fade } from 'svelte/transition';
	import * as m from '#lib/paraglide/messages';

	let {
		canGoBack,
		canGoHome,
		connected,
		onBack,
		onHome
	}: {
		canGoBack: boolean;
		canGoHome: boolean;
		connected: boolean;
		onBack: () => void;
		onHome: () => void;
	} = $props();
</script>

<header class="grid grid-cols-3 items-center px-4 pt-4 pb-2">
	<div class="justify-self-start">
		{#if canGoBack}
			<button
				type="button"
				onclick={onBack}
				transition:fade={{ duration: 200 }}
				class="rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
			>
				&larr; {m.back()}
			</button>
		{/if}
	</div>
	{#if canGoHome}
		<button
			type="button"
			onclick={onHome}
			aria-label={m.home()}
			transition:fade={{ duration: 200 }}
			class="justify-self-center rounded-full bg-white/12 p-4 text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="size-7"
			>
				<path d="M3 10.5 12 3l9 7.5" />
				<path d="M5.5 9.5V20a1 1 0 0 0 1 1h4v-6h3v6h4a1 1 0 0 0 1-1V9.5" />
			</svg>
		</button>
	{/if}
	<span class="flex items-center gap-2 justify-self-end text-xs text-white/50">
		<span class="size-2 rounded-full {connected ? 'bg-emerald-400' : 'bg-white/30'}"></span>
		{connected ? m.connected() : m.connecting()}
	</span>
</header>
