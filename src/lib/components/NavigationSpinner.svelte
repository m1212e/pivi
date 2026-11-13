<script lang="ts">
	import { isPlayPath } from '#lib/routes';
	// Mounted in the root layout. Opening the player waits on the app to resolve
	// the session, so SvelteKit lingers on the old screen with no feedback.
	// Limited to /play/ navigations since others resolve too fast to need it.
	import { LoaderCircle } from '@lucide/svelte';
	import { navigating } from '$app/state';

	const isPlayerNav = $derived(isPlayPath(navigating.to?.url.pathname ?? ''));

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
