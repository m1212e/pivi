<script lang="ts">
	// Scanning for and joining a network. The TV's own page (/wifi), driven
	// with nothing but the remote's gestures — so everything here works by
	// moving focus and pressing, and the password goes into an ordinary field
	// (the remote relays the phone's keyboard to whichever one has focus),
	// never a native dialog a remote could never answer.
	//
	// It sends nothing itself: whoever renders it passes the actions in.
	import { AlertCircle, Check, Lock, LoaderCircle, RefreshCw, Wifi, WifiOff } from '@lucide/svelte';
	import type { WifiManagementState } from '#lib/wifi/management';
	import { wifiStatusLabel } from '#lib/wifi/status';
	import * as m from '#lib/paraglide/messages';

	type WifiNetwork = NonNullable<WifiManagementState['networks']>[number];

	let {
		wifi,
		onScan,
		onConnect
	}: {
		wifi: WifiManagementState;
		onScan: () => void;
		onConnect: (ssid: string, password: string, hidden: boolean) => void;
	} = $props();

	// Which network's password is being typed. Null means the list is showing.
	let selected = $state<WifiNetwork | null>(null);
	let password = $state('');

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

	// Four bars' worth of signal, which is as much resolution as anyone reads
	// off a list like this.
	function bars(signal: number): number {
		return Math.max(1, Math.min(4, Math.ceil(signal / 25)));
	}

	const buttonBase =
		'rounded-2xl px-5 py-3 font-medium transition focus:outline-none disabled:opacity-50';
</script>

{#snippet signalBars(signal: number)}
	<span
		class="flex size-9 shrink-0 items-end justify-center gap-0.5 rounded-full bg-white/10 pb-2"
		aria-hidden="true"
	>
		{#each [1, 2, 3, 4] as level (level)}
			<span
				class="w-1 rounded-full {level <= bars(signal) ? 'bg-emerald-400' : 'bg-white/20'}"
				style="height: {level * 3 + 2}px"
			></span>
		{/each}
	</span>
{/snippet}

{#snippet passwordForm(network: WifiNetwork)}
	<form
		onsubmit={submitPassword}
		class="flex flex-col gap-3 rounded-3xl bg-white/10 p-4 ring-1 ring-white/20"
	>
		<label class="flex flex-col gap-1.5 text-sm text-white/60" for="wifi-password">
			<span class="flex items-center gap-1.5">
				<Lock class="size-3.5" />
				{m.wifi_password_for({ ssid: network.ssid })}
			</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="wifi-password"
				type="password"
				autocomplete="off"
				autofocus
				bind:value={password}
				enterkeyhint="go"
				placeholder={m.wifi_password_placeholder()}
				class="rounded-2xl bg-white/12 px-4 py-3 text-white placeholder-white/30 ring-1 ring-white/25 focus:outline-none"
			/>
		</label>
		<div class="flex gap-2">
			<button
				type="submit"
				class="flex-1 bg-indigo-500 text-white hover:bg-indigo-400 {buttonBase}"
			>
				{m.wifi_join()}
			</button>
			<button
				type="button"
				onclick={() => (selected = null)}
				class="bg-white/12 text-white/80 hover:bg-white/20 {buttonBase}"
			>
				{m.wifi_cancel()}
			</button>
		</div>
	</form>
{/snippet}

{#snippet networkList(networks: WifiNetwork[])}
	<ul class="flex flex-col gap-2">
		{#each networks as network (network.ssid)}
			<li>
				<button
					type="button"
					onclick={() => pick(network)}
					class="flex w-full items-center gap-3 rounded-2xl bg-white/10 px-3 py-2.5 text-left ring-1 ring-white/15 transition hover:bg-white/20 focus:outline-none"
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

<div class="flex flex-col gap-4">
	{#if wifi.error}
		<div class="flex items-center gap-3 rounded-2xl bg-red-500/15 px-4 py-3 ring-1 ring-red-400/30">
			<AlertCircle class="size-5 shrink-0 text-red-300" />
			<p class="text-sm text-red-200">{m.wifi_connect_failed({ error: wifi.error })}</p>
		</div>
	{/if}

	{#if !wifi.available}
		<div
			class="flex items-center gap-3 rounded-2xl bg-amber-500/10 px-4 py-3 ring-1 ring-amber-400/25"
		>
			<WifiOff class="size-5 shrink-0 text-amber-300" />
			<p class="text-sm text-amber-200">{m.wifi_unavailable()}</p>
		</div>
	{:else if wifi.connectingSsid}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-3xl bg-white/5 py-12 ring-1 ring-white/10"
		>
			<LoaderCircle class="size-8 animate-spin text-indigo-300" />
			<p class="text-sm text-white/60">{wifiStatusLabel(wifi)}</p>
		</div>
	{:else if selected}
		{@render passwordForm(selected)}
	{:else}
		{#if wifi.networks === null || wifi.networks.length === 0}
			<div
				class="flex flex-col items-center gap-2 rounded-3xl bg-white/5 py-12 text-center ring-1 ring-white/10"
			>
				<Wifi class="size-7 text-white/25" />
				<p class="text-sm text-white/40">
					{wifi.scanning ? m.wifi_scanning() : m.wifi_no_networks()}
				</p>
			</div>
		{:else}
			{@render networkList(wifi.networks)}
		{/if}

		<button
			type="button"
			onclick={onScan}
			disabled={wifi.scanning}
			class="flex items-center justify-center gap-2 bg-white/12 text-white/85 ring-1 ring-white/25 hover:bg-white/20 {buttonBase}"
		>
			<RefreshCw class="size-4 {wifi.scanning ? 'animate-spin' : ''}" />
			{wifi.scanning ? m.wifi_scanning() : m.wifi_scan()}
		</button>
	{/if}
</div>
