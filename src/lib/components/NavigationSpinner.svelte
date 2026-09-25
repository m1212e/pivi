<script lang="ts">
	// Opening the player takes a real network round trip (resolving the
	// session with the plugin) before the destination page's own top-level
	// await settles -- see the `info` fetch in play/[pluginId]/[sessionId]'s
	// +page.svelte -- so SvelteKit sits on the old screen for a moment with no
	// feedback that the click landed. Shown only for that navigation, not
	// every one, since screens like home<->app resolve fast enough that a
	// spinner would just flash.
	import { LoaderCircle } from '@lucide/svelte';
	import { navigating } from '$app/state';

	const isPlayerNav = $derived(navigating.to?.url.pathname.startsWith('/play/') ?? false);

	// Delayed rather than shown the instant navigation starts, so a
	// fast-enough resolve never flashes a spinner for a frame or two.
	const SHOW_DELAY_MS = 200;
	let show = $state(false);

	$effect(() => {
		if (!isPlayerNav) {
			show = false;
			return;
		}
		const timeout = setTimeout(() => {
			show = true;
		}, SHOW_DELAY_MS);
		return () => clearTimeout(timeout);
	});
</script>

{#if show}
	<div
		class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm"
	>
		<LoaderCircle class="size-12 animate-spin text-white/80" />
	</div>
{/if}
