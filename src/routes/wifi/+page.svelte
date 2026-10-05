<script lang="ts">
	// Scan for and join a wifi network from the TV itself, with nothing but
	// the remote's gestures: move focus with the trackpad, press to select,
	// and type a password into the focused field on the phone's keyboard.
	import * as m from '#lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { graphQLErrorMessage } from '#lib/api/errors';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import WifiManagerPanel from '#lib/components/WifiManagerPanel.svelte';
	import { wifiManagementSchema, type WifiManagementState } from '#lib/wifi/management';
	import { wifiStatusIcon, wifiStatusLabel } from '#lib/wifi/status';

	const FIELDS = {
		available: true,
		mode: true,
		ssid: true,
		online: true,
		ethernet: true,
		networks: { ssid: true, signal: true, security: true, saved: true },
		scanning: true,
		connectingSsid: true,
		errorMessage: true
	} as const;

	const EMPTY: WifiManagementState = {
		available: false,
		mode: 'disconnected',
		ssid: null,
		online: false,
		ethernet: false,
		networks: null,
		scanning: false,
		connectingSsid: null,
		error: null
	};

	// What liveQuery hands back is a memoized Proxy that's the same object on every
	// emission (see home/+page.svelte), so it's copied into plain data — and
	// checked against the shape the panel expects — before it becomes $state.
	type Fetched = Omit<WifiManagementState, 'error'> & { errorMessage: string | null };

	// The GraphQL field is `errorMessage` (a field called `error` would be thrown by
	// the generated client); the panel's shape calls it `error`.
	function toState(value: unknown): WifiManagementState | null {
		const { errorMessage, ...rest } = JSON.parse(JSON.stringify(value)) as Fetched;
		const parsed = wifiManagementSchema.safeParse({ ...rest, error: errorMessage });
		return parsed.success ? parsed.data : null;
	}

	const initial = await client.liveQuery.wifiManagement(FIELDS);
	// Not called `state`: a variable of that name makes `$state(...)` parse as a store
	// dereference of it.
	let managed = $state<WifiManagementState>((initial && toState(initial)) || EMPTY);

	// A mutation can be refused outright (no paired phone connected); anything that
	// goes wrong while the work runs arrives through the shared state instead.
	let refusal = $state<string | null>(null);

	onMount(() => {
		const subscription = client.liveQuery.wifiManagement(FIELDS).subscribe((value) => {
			const next = value && toState(value);
			if (next) managed = next;
		});
		return () => stopSubscription(subscription);
	});

	function run(request: Promise<unknown>) {
		refusal = null;
		request.catch((err: unknown) => (refusal = graphQLErrorMessage(err, m.wifi_refused())));
	}

	function scan() {
		run(client.mutate.scanWifiNetworks());
	}

	function connect(ssid: string, password: string, hidden: boolean) {
		run(client.mutate.connectWifiNetwork({ __args: { ssid, password, hidden } }));
	}

	const StatusIcon = $derived(wifiStatusIcon(managed));
</script>

<svelte:head><title>{m.wifi_title()}</title></svelte:head>

<div class="flex min-h-screen flex-col gap-6 bg-slate-950 px-8 py-10 text-white sm:px-12">
	<div class="flex items-start justify-between gap-4">
		<h1 class="text-2xl font-semibold">{m.wifi_title()}</h1>
		<span
			class="flex items-center gap-2.5 rounded-full bg-white/10 px-4 py-2.5 text-base font-medium text-white/80 ring-1 ring-white/15"
		>
			<StatusIcon class="size-5 {managed.online ? 'text-emerald-400' : 'text-white/50'}" />
			{wifiStatusLabel(managed)}
		</span>
	</div>

	{#if refusal}
		<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">
			{refusal}
		</p>
	{/if}

	<div class="max-w-xl">
		<WifiManagerPanel wifi={managed} onScan={scan} onConnect={connect} />
	</div>
</div>
