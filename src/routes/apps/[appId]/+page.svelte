<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import { flushSync, untrack } from 'svelte';
	import { page } from '$app/state';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
	import UiNodeRenderer from '#lib/components/apps/UiNodeRenderer.svelte';
	import type { UiNode } from '#sdk/ui';
	import AppIcon from '#lib/components/AppIcon.svelte';
	import { appAuroraStyle } from '#lib/appAccent';

	const appId = page.params.appId!;

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

	// Which of the app's screens is shown: whatever a `screen` action linked to
	// (#lib/apps/actionHref), otherwise the one its manifest opens on.
	const screenId = $derived(page.url.searchParams.get('screen') ?? app?.entryScreenId);

	let screen = $state<UiNode | null>(null);

	// Text and a toggle's state travel as separate arguments, so the app gets
	// a real boolean back.
	function eventArgs(value: string | boolean | undefined) {
		return typeof value === 'boolean' ? { checked: value } : { value };
	}

	function onEvent(eventId: string, value?: string | boolean) {
		if (!screenId) return;
		client.mutate
			.appUiEvent({ __args: { appId, screenId, eventId, ...eventArgs(value) } })
			.catch((err: unknown) => console.error('appUiEvent failed', err));
	}

	// Which nav entries are selected, to tell a section switch apart from the
	// many other pushes (search suggestions, more results) an app sends.
	function selectedNav(node: UiNode | null): string {
		if (!node) return '';
		if (node.type === 'button') {
			return node.variant === 'nav' && node.selected ? `${node.onSelect ?? node.label};` : '';
		}
		return 'children' in node ? node.children.map(selectedNav).join('') : '';
	}

	// Only a section switch runs as a view transition, which slides the nav
	// highlight over. Doing it for every push would freeze the page for the
	// length of the animation each time.
	function showScreen(next: UiNode | null) {
		const prev = selectedNav(screen);
		if (!screen || !('startViewTransition' in document) || prev === selectedNav(next)) {
			screen = next;
			return;
		}
		// A zoom kind left over from the last page navigation would otherwise
		// zoom the whole screen here too.
		delete document.documentElement.dataset.viewTransition;
		document.startViewTransition(() => flushSync(() => (screen = next)));
	}

	// A push subscription (src/api/handlers/apps.ts), re-made whenever the
	// shown screen changes. `.subscribe()` fires for the initial value too, so
	// there's no separate fetch. Only an app with the 'screen' feature has
	// anything to show; a sign-in, if it needs one, is part of that content.
	$effect(() => {
		if (!app?.features.includes('screen') || !screenId) return;
		screen = null;
		// The initial value arrives synchronously, and showScreen reads `screen`,
		// which would make this effect depend on the state it writes.
		const subscription = untrack(() =>
			client.liveQuery.appScreen({ __args: { appId, screenId }, json: true }).subscribe((value) => {
				showScreen(value?.json ? (JSON.parse(value.json) as UiNode) : null);
			})
		);
		return () => stopSubscription(subscription);
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
		<UiNodeRenderer node={screen} {onEvent} {appId} />
	{:else if app.features.includes('screen')}
		<LoadingSpinner />
	{:else}
		<p class="text-white/50">{m.app_no_screen()}</p>
	{/if}
</div>
