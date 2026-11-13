<script lang="ts">
	// Corner QR from the root layout so a phone remote can be paired from any
	// screen. The layout hides it where a pairing QR is already the main content
	// and in the player. It also hides once a phone connects, as it's just noise then.
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import { getPairing } from '#lib/state/pairing.svelte';
	import { pollEvery } from '#lib/poll';
	import PairingQr from './PairingQr.svelte';

	let { hidden }: { hidden: boolean } = $props();

	let remoteUrl = $state<string | null>(null);
	let phoneConnected = $state(true);

	// The pairing token is refreshed since the overlay can outlive it. The phone
	// state is polled on top of the subscription because a dead stream never
	// reconnects, and the TV may run for days without a reload.
	onMount(() => {
		let cancelled = false;
		getPairing()
			.then((pairing) => {
				if (!cancelled) remoteUrl = pairing.remoteUrl;
			})
			.catch(() => {});
		const stopPairingPoll = pollEvery(60_000, getPairing, (pairing) => {
			remoteUrl = pairing.remoteUrl;
		});
		const stopPhonePoll = pollEvery(
			60_000,
			() => client.query.phoneConnection({ connected: true }),
			(result) => {
				phoneConnected = result.connected;
			}
		);

		const subscription = client.liveQuery
			.phoneConnection({ connected: true })
			.subscribe((value) => {
				if (value) phoneConnected = value.connected;
			});

		return () => {
			cancelled = true;
			stopPairingPoll();
			stopPhonePoll();
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
