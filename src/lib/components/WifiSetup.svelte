<script lang="ts">
	// The phone half of wifi provisioning: the screen that actually has a
	// keyboard on it. Rendered as a sheet over the remote rather than as another
	// entry in its tab model (see the RequiredTab logic in the remote page) —
	// every one of those tabs is something the *TV* asked for, and this is the
	// one screen that exists because of the device's own state instead.
	//
	// It sends nothing itself. The remote page owns the connection and passes
	// the three actions in, which keeps this component free of any knowledge of
	// the relay.
	import { Check, Lock, LoaderCircle, Wifi, WifiOff, X } from '@lucide/svelte';
	import type { z } from 'zod';
	import type { wifiStateParamsSchema } from '#lib/pairing/remoteProtocol';
	import * as m from '#lib/paraglide/messages';

	type WifiState = z.infer<typeof wifiStateParamsSchema>;
	type WifiNetwork = WifiState['networks'] extends (infer T)[] | null ? T : never;

	let {
		// Deliberately not called `state`: a variable of that name in scope makes
		// `$state(...)` below parse as a store dereference of it.
		wifi,
		onScan,
		onConnect,
		onClose
	}: {
		wifi: WifiState;
		onScan: () => void;
		onConnect: (ssid: string, password: string, hidden: boolean) => void;
		onClose: () => void;
	} = $props();

	// Which network's password is being typed. Null means the list is showing.
	let selected = $state<WifiNetwork | null>(null);
	let password = $state('');

	// Local, because a scan's *end* is observable (the networks list arrives)
	// but its start isn't anything the host reports — it would look identical to
	// having never scanned.
	let scanning = $state(false);
	$effect(() => {
		// Referencing `wifi.networks` is what subscribes this to the arrival of a
		// result, which is the only thing that ends a scan from here.
		void wifi.networks;
		scanning = false;
	});

	function requestScan() {
		scanning = true;
		onScan();
	}

	function pick(network: WifiNetwork) {
		// An open network has no password to ask for, and a saved one already has
		// its credentials stored by NetworkManager — joining either is one tap.
		if (network.security === 'open' || network.saved) {
			onConnect(network.ssid, '', false);
			return;
		}
		selected = network;
		password = '';
	}

	function submitPassword(event: SubmitEvent) {
		event.preventDefault();
		if (!selected) return;
		onConnect(selected.ssid, password, false);
		selected = null;
		password = '';
	}

	// A join in flight always names its target, except in the window after a
	// reload where the host hasn't answered yet.
	function connectingLabel(ssid: string | null): string {
		return ssid ? m.wifi_connecting_to({ ssid }) : m.wifi_scanning();
	}

	function idleLabel(mode: WifiState['mode'], ssid: string | null): string {
		if (mode === 'client' && ssid) return m.wifi_current_network({ ssid });
		if (mode === 'hotspot') return m.wifi_on_hotspot();
		return m.wifi_offline();
	}

	const statusLabel = $derived.by(() => {
		if (wifi.connecting) return connectingLabel(wifi.connectingSsid);
		if (wifi.ethernet) return m.wifi_on_ethernet();
		return idleLabel(wifi.mode, wifi.ssid);
	});

	// Four bars' worth of signal, which is as much resolution as anyone reads
	// off a list like this.
	function bars(signal: number): number {
		return Math.max(1, Math.min(4, Math.ceil(signal / 25)));
	}
</script>

{#snippet passwordForm(network: WifiNetwork)}
	<form onsubmit={submitPassword} class="flex flex-col gap-3 px-4">
		<label class="text-sm text-white/70" for="wifi-password">
			{m.wifi_password_for({ ssid: network.ssid })}
		</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="wifi-password"
			type="password"
			autocomplete="off"
			autofocus
			bind:value={password}
			enterkeyhint="go"
			placeholder={m.wifi_password_placeholder()}
			class="w-full rounded-2xl bg-white/12 px-5 py-4 text-lg text-white placeholder-white/40 ring-1 ring-white/25 focus:outline-none"
		/>
		<div class="flex gap-2">
			<button
				type="submit"
				class="flex-1 rounded-2xl bg-indigo-500 px-5 py-3 font-medium text-white transition hover:bg-indigo-400 focus:outline-none"
			>
				{m.wifi_join()}
			</button>
			<button
				type="button"
				onclick={() => (selected = null)}
				class="rounded-2xl bg-white/12 px-5 py-3 text-white/80 transition hover:bg-white/20 focus:outline-none"
			>
				{m.wifi_cancel()}
			</button>
		</div>
	</form>
{/snippet}

{#snippet signalBars(signal: number)}
	<span class="flex items-end gap-0.5" aria-hidden="true">
		{#each [1, 2, 3, 4] as level (level)}
			<span
				class="w-1 rounded-full {level <= bars(signal) ? 'bg-white/80' : 'bg-white/20'}"
				style="height: {level * 3 + 2}px"
			></span>
		{/each}
	</span>
{/snippet}

{#snippet networkList(networks: WifiNetwork[])}
	<ul class="flex flex-col gap-2">
		{#each networks as network (network.ssid)}
			<li>
				<button
					type="button"
					onclick={() => pick(network)}
					class="flex w-full items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-left transition hover:bg-white/20 focus:outline-none"
				>
					{@render signalBars(network.signal)}
					<span class="min-w-0 flex-1 truncate text-white/90">{network.ssid}</span>
					{#if network.saved}
						<Check class="size-4 shrink-0 text-emerald-400" aria-label={m.wifi_saved()} />
					{/if}
					{#if network.security !== 'open'}
						<Lock class="size-4 shrink-0 text-white/40" />
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet browser()}
	{#if wifi.error}
		<p
			class="mx-4 mb-3 rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30"
		>
			{m.wifi_connect_failed({ error: wifi.error })}
		</p>
	{/if}

	<div class="flex-1 overflow-y-auto px-4 pb-4">
		{#if wifi.networks === null}
			<p class="py-8 text-center text-sm text-white/40">
				{scanning ? m.wifi_scanning() : m.wifi_no_networks()}
			</p>
		{:else if wifi.networks.length === 0}
			<p class="py-8 text-center text-sm text-white/40">{m.wifi_no_networks()}</p>
		{:else}
			{@render networkList(wifi.networks)}
		{/if}
	</div>

	<div class="px-4 pb-6">
		<button
			type="button"
			onclick={requestScan}
			disabled={scanning}
			class="w-full rounded-2xl bg-white/12 px-5 py-3 font-medium text-white/85 ring-1 ring-white/25 transition hover:bg-white/20 focus:outline-none disabled:opacity-50"
		>
			{scanning ? m.wifi_scanning() : m.wifi_scan()}
		</button>
	</div>
{/snippet}

<div class="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-xl">
	<header class="flex items-center justify-between px-4 pt-4 pb-2">
		<h2 class="flex items-center gap-2 text-lg font-semibold text-white/90">
			{#if wifi.online}
				<Wifi class="size-5 text-emerald-400" />
			{:else}
				<WifiOff class="size-5 text-white/40" />
			{/if}
			{m.wifi_title()}
		</h2>
		<button
			type="button"
			onclick={onClose}
			aria-label={m.wifi_cancel()}
			class="rounded-full bg-white/12 p-2 text-white/70 transition hover:bg-white/20 focus:outline-none"
		>
			<X class="size-5" />
		</button>
	</header>

	<p class="px-4 pb-3 text-sm text-white/50">{statusLabel}</p>

	{#if !wifi.available}
		<p class="px-4 text-sm text-amber-300/80">{m.wifi_unavailable()}</p>
	{:else if wifi.connecting}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-white/60">
			<LoaderCircle class="size-8 animate-spin" />
		</div>
	{:else if selected}
		{@render passwordForm(selected)}
	{:else}
		{@render browser()}
	{/if}
</div>
