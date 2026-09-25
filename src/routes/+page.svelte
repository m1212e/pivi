<script lang="ts">
	import { page } from '$app/state';
	import { profileGradient } from '#lib/profileColor';
	import PairingQr from '#lib/components/PairingQr.svelte';
	import { client } from '#lib/api/rumbleClient/client';
	import { getPairing } from '#lib/state/pairing.svelte';
	import * as m from '#lib/paraglide/messages';

	const profiles = await client.liveQuery.users({
		id: true,
		username: true,
		image: true
	});

	// Set by home's own signOut() (a full reload, not a client-side nav) so
	// this page knows which one profile to statically tag for the
	// shared-element morph -- unlike the picker->PIN leg, which
	// +layout.svelte's onNavigate can tag dynamically since that's a
	// same-document navigation, a hard reload has no other way to hand this
	// off, and this page shows many avatars at once so it can't just tag one
	// unconditionally the way the PIN and home pages (each showing only one)
	// already do.
	const signedOutProfileId = page.url.searchParams.get('from');

	// The QR code embeds a short-lived pairing token, so if this idle screen
	// sits open long enough for it to expire, refresh it before that happens
	// rather than leaving a dead code on screen.
	let pairing = $state(await getPairing());
	$effect(() => {
		const interval = setInterval(async () => {
			pairing = await getPairing();
		}, 60_000);
		return () => clearInterval(interval);
	});
</script>

<svelte:head><title>Pivi</title></svelte:head>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-16 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-8 py-16 text-white"
>
	<h1 class="text-4xl font-semibold tracking-tight text-white/95 sm:text-5xl">
		{m.who_is_watching()}
	</h1>

	<div class="flex flex-wrap items-start justify-center gap-x-12 gap-y-10">
		{#each profiles as profile (profile.id)}
			{@const label = profile.username}
			<a
				href="/login/{profile.id}"
				data-pivi-profile-id={profile.id}
				data-pivi-profile-username={label}
				data-pivi-profile-image={profile.image ?? ''}
				class="group flex w-32 flex-col items-center gap-3 focus:outline-none sm:w-36"
			>
				<span
					data-focus-ring-target
					class="flex size-28 items-center justify-center overflow-hidden rounded-full transition group-hover:scale-105 sm:size-32"
					style="background: {profileGradient(profile.username ?? profile.id)}"
					style:view-transition-name={profile.id === signedOutProfileId
						? 'profile-avatar'
						: undefined}
				>
					{#if profile.image}
						<img src={profile.image} alt="" class="size-full object-cover" />
					{:else}
						<span class="text-4xl font-semibold text-white/90 uppercase sm:text-5xl">
							{label.slice(0, 1)}
						</span>
					{/if}
				</span>
				<span class="max-w-full truncate text-lg font-medium text-white/90">{label}</span>
			</a>
		{/each}

		<a
			href="/register"
			class="group flex w-32 flex-col items-center gap-3 focus:outline-none sm:w-36"
		>
			<span
				data-focus-ring-target
				class="flex size-28 items-center justify-center rounded-full border-2 border-dashed border-white/30 bg-white/12 text-white/50 backdrop-blur-2xl backdrop-saturate-150 transition group-hover:scale-105 group-hover:border-white/70 group-hover:text-white/80 sm:size-32"
			>
				<svg viewBox="0 0 24 24" fill="none" class="size-12 sm:size-14">
					<path
						d="M12 5v14M5 12h14"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			</span>
			<span class="text-lg font-medium text-white/70">{m.new_profile()}</span>
		</a>
	</div>

	{#if pairing.remoteUrl}
		<div
			class="flex items-center gap-5 rounded-3xl bg-white/12 px-6 py-5 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
		>
			<!-- Only one QR code is ever on screen on this page, unlike the
			     profile avatars below -- safe to name statically rather than
			     needing +layout.svelte to pick it out dynamically. -->
			<div style:view-transition-name="pairing-qr">
				<PairingQr url={pairing.remoteUrl} size={192} />
			</div>
			<div class="max-w-56 text-sm text-white/60">
				<p class="font-medium text-white/90">{m.scan_with_phone()}</p>
				<p>{m.remote_description()}</p>
			</div>
		</div>
	{/if}
</div>
