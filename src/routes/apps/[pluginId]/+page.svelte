<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import UiNodeRenderer from '#lib/components/plugins/UiNodeRenderer.svelte';
	import type { UiNode } from '#lib/plugins/ui';

	const pluginId = page.params.pluginId!;
	const APP_HREF = `/apps/${encodeURIComponent(pluginId)}`;

	const plugins = await client.liveQuery.plugins({
		id: true,
		name: true,
		features: true,
		entryScreenId: true
	});
	const plugin = plugins.find((p) => p.id === pluginId);

	let auth = $state<{ status: string; userCode: string; verificationUrl: string } | null>(null);
	let screen = $state<UiNode | null>(null);

	function onEvent(eventId: string, value?: string | boolean) {
		if (!plugin) return;
		client.mutate
			.pluginUiEvent({
				__args: {
					pluginId,
					screenId: plugin.entryScreenId,
					eventId,
					value: typeof value === 'string' ? value : undefined
				}
			})
			.catch((err: unknown) => console.error('pluginUiEvent failed', err));
	}

	function openOnPhone() {
		const url = auth?.verificationUrl;
		if (!url) return;
		client.mutate
			.openUrlOnPhone({ __args: { url } })
			.catch((err: unknown) => console.error('openUrlOnPhone failed', err));
	}

	onMount(() => {
		if (!plugin) return;

		// A real push subscription (src/api/handlers/plugins.ts +
		// plugins/pubsub.ts), not a polling setInterval — these fields aren't
		// backed by a DB table rumble can push updates for on its own, but the
		// plugin host publishes an event on this same pubsub whenever a
		// plugin's screen/auth actually changes, so this component hears about
		// it the instant it happens (and, with the client's default cache-first
		// policy, otherwise not at all). `.subscribe()` on the object returned
		// by a liveQuery call fires for every value the underlying
		// query+subscription observable produces, including the initial one,
		// so there's no separate one-shot fetch to also do here.
		//
		// `.subscribe()` returns an ES Observable Subscription object with an
		// `.unsubscribe()` method — not a plain unsubscribe function — so the
		// cleanup below calls that, not the returned value itself.
		// Copied into a plain object rather than assigned directly — see
		// home/+page.svelte's dashboards comment: the raw value is a memoized
		// Proxy reused across every emission, so a later push through it can
		// be reference-equal to the previous one and get silently skipped by
		// Svelte's reactivity.
		//
		// The generated client's Response<Data, ...> type distributes over
		// Data's own GraphQL-level nullability (pluginAuth is a nullable
		// field), which makes `authResponse` itself look possibly-null at the
		// type level even though it's always a real Subscribeable object at
		// runtime — a conditional-type-over-a-union quirk in generated code we
		// don't control, not an actual null case to guard against.
		const authResponse = client.liveQuery.pluginAuth({
			__args: { pluginId },
			status: true,
			userCode: true,
			verificationUrl: true
		});
		const authSubscription = authResponse!.subscribe((value) => {
			auth = value ? { ...value } : null;
		});

		// Only a plugin that implements the 'screen' feature has anything to show
		// here; one without just gets the "no content" state below.
		const screenSubscription = plugin.features.includes('screen')
			? client.liveQuery
					.pluginScreen({ __args: { pluginId, screenId: plugin.entryScreenId }, json: true })
					.subscribe((value) => {
						screen = value?.json ? (JSON.parse(value.json) as UiNode) : null;
					})
			: undefined;

		return () => {
			stopSubscription(authSubscription);
			if (screenSubscription) stopSubscription(screenSubscription);
		};
	});
</script>

<svelte:head><title>{plugin?.name ?? pluginId}</title></svelte:head>

<div class="flex min-h-screen flex-col gap-8 bg-slate-950 px-8 py-10 text-white sm:px-12">
	<h1 class="text-2xl font-semibold">{plugin?.name ?? pluginId}</h1>

	{#if !plugin}
		<p class="text-white/50">{m.plugin_not_found()}</p>
	{:else if auth && auth.status !== 'complete'}
		<div class="flex flex-col items-start gap-3 rounded-2xl bg-white/12 p-6">
			<p class="text-white/80">{m.plugin_sign_in_at({ url: auth.verificationUrl })}</p>
			<p class="font-mono text-3xl tracking-widest">{auth.userCode}</p>
			<p class="text-sm text-white/50">{m.plugin_status({ status: auth.status })}</p>
			<button
				type="button"
				onclick={openOnPhone}
				class="rounded-full bg-white px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-white/90 focus:outline-none"
			>
				{m.plugin_open_on_phone()}
			</button>
		</div>
	{:else if screen}
		<UiNodeRenderer node={screen} {onEvent} {pluginId} appHref={APP_HREF} />
	{:else if plugin.features.includes('screen')}
		<p class="text-white/50">{m.loading()}</p>
	{:else}
		<p class="text-white/50">{m.plugin_no_screen()}</p>
	{/if}
</div>
