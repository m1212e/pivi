<script lang="ts">
	// The TV half of wifi provisioning: what to show when this device can't
	// reach the network. It is deliberately just instructions — there's nothing
	// to type into until a phone is paired as the remote (see
	// src/api/wifiBootstrap.ts for why), so this screen only has to get a phone
	// onto the device's own access point and then into the remote; picking a
	// real network happens on the TV's own /wifi screen once that's done.
	//
	// Two QR codes rather than one, because they do genuinely different things
	// and no single code can do both: the first is a `WIFI:` code, which phone
	// cameras read as "join this network", and the second is the ordinary
	// pairing URL, which is only reachable *after* the phone has joined.
	import PairingQr from './PairingQr.svelte';
	import * as m from '#lib/paraglide/messages';

	let {
		hotspotSsid,
		hotspotPassword,
		remoteUrl,
		onDismiss
	}: {
		hotspotSsid: string;
		hotspotPassword: string;
		remoteUrl: string | null;
		onDismiss: () => void;
	} = $props();

	// The de-facto standard wifi QR format, understood by the stock camera app
	// on both iOS and Android. `\`, `;`, `,`, `"` and `:` are the characters its
	// grammar reserves, so they have to be escaped inside a value — an SSID or
	// password containing one is unusual but entirely legal.
	function wifiQrPayload(ssid: string, password: string): string {
		const escape = (value: string) => value.replace(/([\\;,":])/g, '\\$1');
		return `WIFI:T:WPA;S:${escape(ssid)};P:${escape(password)};;`;
	}

	const joinPayload = $derived(wifiQrPayload(hotspotSsid, hotspotPassword));
</script>

<div
	class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-8 py-12 text-white"
>
	<div class="flex flex-col items-center gap-3 text-center">
		<h1 class="text-4xl font-semibold tracking-tight text-white/95">{m.network_setup_title()}</h1>
		<p class="max-w-xl text-lg text-white/60">{m.network_setup_intro()}</p>
	</div>

	<div class="flex flex-wrap items-stretch justify-center gap-6">
		<div
			class="flex w-80 flex-col items-center gap-4 rounded-3xl bg-white/12 px-6 py-6 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
		>
			<PairingQr url={joinPayload} size={176} />
			<div class="text-center text-sm text-white/60">
				<p class="font-medium text-white/90">{m.network_step_join_ap()}</p>
				<p>{m.network_step_join_ap_hint({ ssid: hotspotSsid })}</p>
				<p class="mt-1 font-mono text-white/75">
					{m.network_ap_password({ password: hotspotPassword })}
				</p>
			</div>
		</div>

		<div
			class="flex w-80 flex-col items-center gap-4 rounded-3xl bg-white/12 px-6 py-6 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
		>
			{#if remoteUrl}
				<PairingQr url={remoteUrl} size={176} />
			{:else}
				<!-- No LAN address yet: the access point is still coming up, and the
				     pairing URL has nothing to point at until it has. The first
				     card is still actionable, so the screen stays useful. -->
				<div class="size-44 animate-pulse rounded-2xl bg-white/10"></div>
			{/if}
			<div class="text-center text-sm text-white/60">
				<p class="font-medium text-white/90">{m.network_step_open_remote()}</p>
				<p>{m.network_step_open_remote_hint()}</p>
			</div>
		</div>
	</div>

	<!-- An escape hatch, not a real workflow: nothing in Pivi works offline, but
	     refusing to let anyone past a setup screen is worse than letting them
	     look around. -->
	<button
		type="button"
		onclick={onDismiss}
		class="rounded-full px-5 py-2 text-sm text-white/45 transition hover:bg-white/10 hover:text-white/80 focus:outline-none"
	>
		{m.network_continue_offline()}
	</button>
</div>
