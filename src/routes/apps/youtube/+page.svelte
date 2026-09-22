<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { client } from '#lib/api/rumbleClient/client';
	import UiNodeRenderer from '#lib/components/plugins/UiNodeRenderer.svelte';
	import type { UiNode } from '#lib/plugins/ui';

	let auth = $state<{ status: string; userCode: string; verificationUrl: string } | null>(null);
	let screen = $state<UiNode | null>(null);

	function onEvent(eventId: string, value?: string | boolean) {
		client.mutate
			.youtubeUiEvent({
				__args: { eventId, value: typeof value === 'string' ? value : undefined }
			})
			.catch((err: unknown) => console.error('youtubeUiEvent failed', err));
	}

	function openOnPhone() {
		const url = auth?.verificationUrl;
		if (!url) return;
		client.mutate
			.openUrlOnPhone({ __args: { url } })
			.catch((err: unknown) => console.error('openUrlOnPhone failed', err));
	}

	onMount(() => {
		// A real push subscription (src/api/handlers/youtube.ts +
		// plugins/pubsub.ts), not a polling setInterval — these fields aren't
		// backed by a DB table rumble can push updates for on its own, but the
		// plugin host publishes an event on this same pubsub whenever a
		// plugin's dashboard/screen/auth actually changes, so this component
		// hears about it the instant it happens rather than up to POLL_MS
		// late (and, with the client's default cache-first policy, not at all
		// — see the conversation this fixes). `.subscribe()` on the object
		// returned by a liveQuery call fires for every value the underlying
		// query+subscription observable produces, including the initial one,
		// so there's no separate one-shot fetch to also do here.
		const authResponse = client.liveQuery.youtubeAuth({
			status: true,
			userCode: true,
			verificationUrl: true
		});
		// The generated client's Response<Data, ...> type distributes over
		// Data's own GraphQL-level nullability (youtubeAuth is a nullable
		// field), which makes `authResponse` itself look possibly-null at the
		// type level even though it's always a real Subscribeable object at
		// runtime — a conditional-type-over-a-union quirk in generated code
		// we don't control, not an actual null case to guard against.
		// `.subscribe()` here is an ES Observable subscribe (wonka, under the
		// generated client), which returns a Subscription object with an
		// `.unsubscribe()` method — not a plain unsubscribe function, even
		// though it's easy to assume that from the name. Calling the returned
		// value directly (as `unsubAuth()`) throws "not a function" as soon as
		// this cleanup actually runs (client-side back-navigation away from
		// this page, not a full reload, is what exposed it).
		// Copied into a plain object rather than assigned directly — see
		// home/+page.svelte's youtubeCards comment: the raw value is a
		// memoized Proxy reused across every emission, so a later push
		// through it can be reference-equal to the previous one and get
		// silently skipped by Svelte's reactivity.
		const authSubscription = authResponse!.subscribe((value) => {
			auth = value ? { ...value } : null;
		});
		const screenResponse = client.liveQuery.youtubeScreen({ json: true });
		const screenSubscription = screenResponse.subscribe((value) => {
			screen = value?.json ? (JSON.parse(value.json) as UiNode) : null;
		});

		return () => {
			authSubscription.unsubscribe();
			screenSubscription.unsubscribe();
		};
	});

	// A dashboard card's action (see #lib/plugins/dashboard's pluginActionHref)
	// lands here as a `deepLink` query param rather than this page needing to
	// know anything about where it was clicked from — it's just the same
	// event id the browse screen's own Play buttons already send (onEvent
	// below), so the plugin doesn't need a separate "open this video" concept.
	onMount(() => {
		const deepLink = page.url.searchParams.get('deepLink');
		if (deepLink) onEvent(deepLink);
	});
</script>

<svelte:head><title>YouTube</title></svelte:head>

<div class="flex min-h-screen flex-col gap-8 bg-slate-950 px-8 py-10 text-white sm:px-12">
	<h1 class="text-2xl font-semibold">YouTube</h1>

	{#if auth && auth.status !== 'complete'}
		<div class="flex flex-col items-start gap-3 rounded-2xl bg-white/12 p-6">
			<p class="text-white/80">Sign in at <strong>{auth.verificationUrl}</strong></p>
			<p class="font-mono text-3xl tracking-widest">{auth.userCode}</p>
			<p class="text-sm text-white/50">Status: {auth.status}</p>
			<button
				type="button"
				onclick={openOnPhone}
				class="rounded-full bg-white px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-white/90 focus:outline-none"
			>
				Open on your phone
			</button>
		</div>
	{:else if screen}
		<UiNodeRenderer node={screen} {onEvent} />
	{:else}
		<p class="text-white/50">Loading…</p>
	{/if}
</div>
