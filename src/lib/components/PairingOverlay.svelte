<script lang="ts">
	// A persistent "scan to connect a phone" affordance, shown over every
	// screen it makes sense on -- see +layout.svelte for exactly which
	// (the routes that already show their own pairing QR as primary content,
	// and the player, are excluded there). Hidden the moment a phone is
	// already connected, since the whole point is getting one connected: the
	// remote is this app's only input device apart from the TV itself, so a
	// corner QR nobody needs to scan is just noise once that's solved.
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import { getPairing } from '#lib/state/pairing.svelte';
	import PairingQr from './PairingQr.svelte';

	let { hidden }: { hidden: boolean } = $props();

	let remoteUrl = $state<string | null>(null);
	let phoneConnected = $state(true);

	// Same short-lived-token refresh as the home/login screens -- this can
	// sit visible long enough for the pairing code to expire.
	//
	// phoneConnected also gets re-polled here, not just pushed over the
	// subscription: if the long-lived subscription stream ever dies (proxy
	// idle timeout, server restart) it tears down silently with nothing to
	// reconnect it, and the TV can stay on for days without a reload, so a
	// stale "disconnected" reading could otherwise stick forever.
	onMount(() => {
		let cancelled = false;
		getPairing().then((pairing) => {
			if (!cancelled) remoteUrl = pairing.remoteUrl;
		});
		const interval = setInterval(async () => {
			const pairing = await getPairing();
			if (!cancelled) remoteUrl = pairing.remoteUrl;

			try {
				const result = await client.query.phoneConnection({ connected: true });
				if (!cancelled) phoneConnected = result.connected;
			} catch {
				// transient network/server hiccup -- next poll will retry
			}
		}, 60_000);

		const subscription = client.liveQuery
			.phoneConnection({ connected: true })
			.subscribe((value) => {
				if (value) phoneConnected = value.connected;
			});

		return () => {
			cancelled = true;
			clearInterval(interval);
			stopSubscription(subscription);
		};
	});

	const visible = $derived(!hidden && !phoneConnected && !!remoteUrl);
</script>

{#if visible}
	<div
		class="fixed top-6 right-8 z-40 rounded-3xl bg-white/12 p-3 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 sm:right-12"
		transition:fade={{ duration: 400 }}
	>
		<div style:view-transition-name="pairing-qr">
			<PairingQr url={remoteUrl!} size={220} />
		</div>
	</div>
{/if}
