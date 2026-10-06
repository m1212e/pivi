<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
	import UiNodeRenderer from '#lib/components/apps/UiNodeRenderer.svelte';
	import type { UiNode } from '#lib/apps/ui';
	import AppIcon from '#lib/components/AppIcon.svelte';
	import { appAuroraStyle } from '#lib/appAccent';

	const appId = page.params.appId!;
	const APP_HREF = `/apps/${encodeURIComponent(appId)}`;

	const apps = await client.liveQuery.apps({
		id: true,
		name: true,
		features: true,
		entryScreenId: true,
		icon: true,
		primaryColor: true,
		secondaryColor: true
	});
	const app = apps.find((p) => p.id === appId);

	let screen = $state<UiNode | null>(null);

	function onEvent(eventId: string, value?: string | boolean) {
		if (!app) return;
		client.mutate
			.appUiEvent({
				__args: {
					appId,
					screenId: app.entryScreenId,
					eventId,
					value: typeof value === 'string' ? value : undefined
				}
			})
			.catch((err: unknown) => console.error('appUiEvent failed', err));
	}

	onMount(() => {
		if (!app) return;

		// A real push subscription (src/api/handlers/apps.ts +
		// apps/pubsub.ts), not a polling setInterval — this field isn't backed
		// by a DB table rumble can push updates for on its own, but the app
		// host publishes an event on this same pubsub whenever a app's screen
		// actually changes, so this component hears about it the instant it
		// happens (and, with the client's default cache-first policy,
		// otherwise not at all). `.subscribe()` on the object returned by a
		// liveQuery call fires for every value the underlying query+subscription
		// observable produces, including the initial one, so there's no
		// separate one-shot fetch to also do here.
		//
		// `.subscribe()` returns an ES Observable Subscription object with an
		// `.unsubscribe()` method — not a plain unsubscribe function — so the
		// cleanup below calls that, not the returned value itself.
		//
		// Only an app that implements the 'screen' feature has anything to show
		// here; one without just gets the "no content" state below. A
		// sign-in (if the app needs one) is part of that same screen content —
		// a code or a button whose action is `openOnPhone` (see
		// UiNodeRenderer.svelte) — not something this page knows about.
		const screenSubscription = app.features.includes('screen')
			? client.liveQuery
					.appScreen({ __args: { appId, screenId: app.entryScreenId }, json: true })
					.subscribe((value) => {
						screen = value?.json ? (JSON.parse(value.json) as UiNode) : null;
					})
			: undefined;

		return () => {
			if (screenSubscription) stopSubscription(screenSubscription);
		};
	});
</script>

<svelte:head><title>{app?.name ?? appId}</title></svelte:head>

<div
	class="relative isolate flex min-h-screen flex-col gap-8 bg-slate-950 px-8 py-10 text-white sm:px-12"
	style={app ? appAuroraStyle(app.primaryColor, app.secondaryColor) : undefined}
>
	<div class="pivi-aurora" aria-hidden="true">
		<span></span><span></span><span></span>
	</div>
	<div class="flex items-center gap-3">
		{#if app}
			<AppIcon
				id={app.id}
				name={app.name}
				icon={app.icon}
				primaryColor={app.primaryColor}
				secondaryColor={app.secondaryColor}
				iconClass="size-7"
				class="size-12"
			/>
		{/if}
		<h1 class="text-2xl font-semibold">{app?.name ?? appId}</h1>
	</div>

	{#if !app}
		<p class="text-white/50">{m.app_not_found()}</p>
	{:else if screen}
		<UiNodeRenderer node={screen} {onEvent} {appId} appHref={APP_HREF} />
	{:else if app.features.includes('screen')}
		<LoadingSpinner />
	{:else}
		<p class="text-white/50">{m.app_no_screen()}</p>
	{/if}
</div>
