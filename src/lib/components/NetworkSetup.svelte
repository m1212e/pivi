<script lang="ts">
	// Shown over the profile picker when the device is offline. Nothing can be
	// typed before a phone is paired, so it only gets a phone onto the hotspot and
	// into the remote. Two QRs since the pairing URL only works after joining.
	import PairingQr from './PairingQr.svelte';
	import * as m from '#lib/paraglide/messages';

	let {
		hotspotSsid,
		hotspotPassword,
		hotspotError,
		remoteUrl
	}: {
		hotspotSsid: string;
		hotspotPassword: string;
		hotspotError: string | null;
		remoteUrl: string | null;
	} = $props();

	// The `WIFI:` format stock iOS and Android cameras offer to join. Its
	// reserved characters are legal in SSIDs and passwords, so they get escaped.
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
			{:else if hotspotError}
				<!-- Nobody can SSH into a fresh device, so the TV is the only place
				     NetworkManager's reason can be read. Retried in the background
				     (wifiBootstrap.ts), so it clears itself if the AP comes up. -->
				<div
					class="flex size-44 flex-col justify-center gap-2 rounded-2xl bg-red-500/15 p-3 text-center ring-1 ring-red-400/30"
				>
					<p class="text-sm font-medium text-red-100">{m.network_hotspot_failed()}</p>
					<p class="line-clamp-5 font-mono text-xs break-words text-red-200/80">{hotspotError}</p>
				</div>
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
</div>
