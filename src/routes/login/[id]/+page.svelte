<script lang="ts">
	import { page } from '$app/state';
	import { profileGradient } from '#lib/profileColor';
	import PinPad from '#lib/components/PinPad.svelte';
	import PairingQr from '#lib/components/PairingQr.svelte';
	import { client } from '#lib/api/rumbleClient/client';
	import { graphQLErrorMessage } from '#lib/api/errors';
	import { getPairing } from '#lib/state/pairing.svelte';
	import * as m from '#lib/paraglide/messages';

	const id = page.params.id!;
	const [profile] = await client.liveQuery.users({
		__args: { where: { id: { eq: id } }, limit: 1 },
		id: true,
		username: true,
		image: true
	});

	let pin = $state('');
	let message = $state<string>();

	// Same idea as the picker's own pairing card (see '/'): lets someone
	// still scan to pair even if they navigated here before ever pairing a
	// phone, rather than only offering that on the screen before this one.
	let pairing = $state(await getPairing());
	$effect(() => {
		const interval = setInterval(async () => {
			pairing = await getPairing();
		}, 60_000);
		return () => clearInterval(interval);
	});

	const label = $derived(profile?.username ?? m.unknown_profile());

	async function submit() {
		try {
			await client.mutate.login({ __args: { username: profile!.username, pin } });
			// A full navigation, not goto()'s client-side routing -- the new
			// profile shouldn't inherit any of the previous session's client-side
			// state (urql's cache, module-level state elsewhere), and tearing
			// down the whole JS runtime is the only way to guarantee that.
			window.location.href = '/home';
		} catch (err) {
			message = graphQLErrorMessage(err, m.wrong_pin());
			pin = '';
		}
	}

	// Wait for the effect queue so the fully-updated 4-digit value is read.
	$effect(() => {
		if (pin.length === 4) submit();
	});
</script>

<svelte:head><title>{m.profile_title({ name: label })}</title></svelte:head>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-8 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-8 py-16 text-white"
>
	<a
		href="/"
		class="absolute top-8 left-8 text-sm font-medium text-white/60 transition hover:text-white focus:outline-none"
	>
		&larr; {m.back()}
	</a>

	{#if !profile}
		<h1 class="text-2xl font-semibold text-white/95">{m.profile_not_found()}</h1>
	{:else}
		<span
			class="flex size-24 items-center justify-center overflow-hidden rounded-full"
			style="background: {profileGradient(profile.username ?? profile.id)}"
			style:view-transition-name="profile-avatar"
		>
			{#if profile.image}
				<img src={profile.image} alt="" class="size-full object-cover" />
			{:else}
				<span class="text-3xl font-semibold text-white/90 uppercase">{label.slice(0, 1)}</span>
			{/if}
		</span>

		<h1 class="text-2xl font-semibold text-white/95">{m.enter_pin_for({ name: label })}</h1>

		<PinPad bind:value={pin} error={message} showKeypad={false} />

		{#if pairing.remoteUrl}
			<div
				class="flex items-center gap-5 rounded-3xl bg-white/12 px-6 py-5 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
			>
				<div style:view-transition-name="pairing-qr">
					<PairingQr url={pairing.remoteUrl} size={192} />
				</div>
				<div class="max-w-56 text-sm text-white/60">
					<p class="font-medium text-white/90">{m.scan_with_phone()}</p>
					<p>{m.remote_description()}</p>
				</div>
			</div>
		{/if}
	{/if}
</div>
