<script lang="ts">
	import * as m from '#lib/paraglide/messages';

	let {
		phase,
		errorMessage
	}: { phase: 'connecting' | 'not-paired' | 'error'; errorMessage: string } = $props();
</script>

{#if phase === 'connecting'}
	<main class="flex flex-1 flex-col items-center justify-center px-8 text-center">
		<p class="text-white/60">{m.connecting()}</p>
	</main>
{:else if phase === 'not-paired'}
	<main class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
		<p class="text-lg font-medium text-white/90">{m.not_paired_title()}</p>
		<p class="max-w-xs text-sm text-white/50">{m.not_paired_description()}</p>
	</main>
{:else}
	<main class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
		<p class="text-lg font-medium text-white/90">{m.pairing_error_title()}</p>
		<p class="max-w-xs text-sm text-white/50">{errorMessage}</p>
	</main>
{/if}
