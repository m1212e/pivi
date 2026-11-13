<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowLeft, Info } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';

	let {
		title,
		visible,
		locked,
		diagnosticsOpen,
		onBack,
		onToggleDiagnostics,
		children
	}: {
		title: string;
		visible: boolean;
		locked: boolean;
		diagnosticsOpen: boolean;
		onBack: () => void;
		onToggleDiagnostics: () => void;
		/** The diagnostics panel, rendered below the title row while open. */
		children: Snippet;
	} = $props();
</script>

<!-- Faded instead of unmounted while idle so remote focus can still reach it
     and bring the UI back. -->
<div
	class="absolute inset-x-0 top-0 bg-linear-to-b from-slate-950/85 via-slate-950/20 to-transparent px-6 pt-6 pb-16 transition-opacity duration-300 sm:px-10 {visible
		? 'opacity-100'
		: 'pointer-events-none opacity-0'}"
>
	<div class="flex items-center gap-4">
		<button
			type="button"
			onclick={onBack}
			disabled={locked}
			aria-label={m.back()}
			class="rounded-full bg-white/12 p-3 text-white shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
		>
			<ArrowLeft class="size-5" />
		</button>
		<h1 class="min-w-0 flex-1 truncate text-lg font-medium text-white sm:text-xl">{title}</h1>
		<button
			type="button"
			onclick={onToggleDiagnostics}
			disabled={locked}
			aria-label={m.playback_diagnostics()}
			aria-pressed={diagnosticsOpen}
			class="rounded-full p-3 shadow-lg ring-1 shadow-black/20 backdrop-blur-2xl backdrop-saturate-150 transition focus:outline-none {diagnosticsOpen
				? 'bg-white text-slate-950'
				: 'bg-white/12 text-white ring-white/25 hover:bg-white/20'}"
		>
			<Info class="size-5" />
		</button>
	</div>

	{#if diagnosticsOpen}
		{@render children()}
	{/if}
</div>
