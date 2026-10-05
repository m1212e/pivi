<script lang="ts">
	// Install and manage apps (apps) from the TV itself, with nothing but the
	// remote's gestures: move focus with the trackpad, press to select, and type
	// into the focused field on the phone's keyboard. The same panel as the phone's
	// own sheet, over the same shared state — an install started on one shows up on
	// the other.
	import * as m from '#lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { graphQLErrorMessage } from '#lib/api/errors';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import AppManagerPanel, { type AppActions } from '#lib/components/AppManagerPanel.svelte';
	import { appsStateSchema, type AppsState } from '#lib/apps/management';
	import type { PermissionKey } from '#lib/apps/manifest';

	const FIELDS = {
		apps: {
			id: true,
			name: true,
			version: true,
			image: true,
			enabled: true,
			autoUpdate: true,
			features: true,
			permissions: { key: true, granted: true },
			domains: true,
			signerFingerprint: true,
			update: { version: true, addedPermissions: true, addedDomains: true },
			errorMessage: true,
			icon: true,
			primaryColor: true,
			secondaryColor: true
		},
		preview: {
			image: true,
			name: true,
			version: true,
			features: true,
			permissions: true,
			domains: true,
			signerFingerprint: true,
			conflict: true,
			icon: true,
			primaryColor: true,
			secondaryColor: true
		},
		busy: true,
		errorMessage: true,
		lastCheckSummary: { checkedAt: true, applied: true, pending: true, failed: true }
	} as const;

	const EMPTY: AppsState = {
		apps: [],
		preview: null,
		busy: null,
		error: null,
		lastCheckSummary: null
	};

	// What liveQuery hands back is a memoized Proxy that's the same object on every
	// emission (see home/+page.svelte), so it's copied into plain data — and
	// checked against the shape the panel expects — before it becomes $state.
	type Fetched = Omit<AppsState, 'error' | 'apps'> & {
		errorMessage: string | null;
		apps: (Omit<AppsState['apps'][number], 'error'> & { errorMessage: string | null })[];
	};

	// The GraphQL fields are `errorMessage` (a field called `error` would be thrown by
	// the generated client); the panel's shape calls them `error`.
	function toState(value: unknown): AppsState | null {
		const { errorMessage, apps, ...rest } = JSON.parse(JSON.stringify(value)) as Fetched;
		const parsed = appsStateSchema.safeParse({
			...rest,
			error: errorMessage,
			apps: apps.map(({ errorMessage: error, ...app }) => ({ ...app, error }))
		});
		return parsed.success ? parsed.data : null;
	}

	const initial = await client.liveQuery.appManagement(FIELDS);
	// Not called `state`: a variable of that name makes `$state(...)` parse as a store
	// dereference of it.
	let managed = $state<AppsState>((initial && toState(initial)) || EMPTY);

	// A short, operator-configured list of known apps (see
	// src/api/apps/suggested.ts) -- fixed for the life of the page, so it's
	// fetched once rather than kept live like the installed set above.
	let suggested = $state<
		{
			id: string;
			name: string;
			description: string;
			icon: string | null;
			image: string;
			publicKey: string | null;
		}[]
	>([]);
	client.query
		.suggestedApps({
			id: true,
			name: true,
			description: true,
			icon: true,
			image: true,
			publicKey: true
		})
		.then((result) => {
			suggested = result ?? [];
		})
		.catch(() => {});

	// A mutation can be refused outright (no paired phone connected); anything that
	// goes wrong while the work runs arrives through the shared state instead.
	let refusal = $state<string | null>(null);

	onMount(() => {
		const subscription = client.liveQuery.appManagement(FIELDS).subscribe((value) => {
			const next = value && toState(value);
			if (next) managed = next;
		});
		return () => stopSubscription(subscription);
	});

	function run(request: Promise<unknown>) {
		refusal = null;
		request.catch((err: unknown) => (refusal = graphQLErrorMessage(err, m.apps_refused())));
	}

	const actions: AppActions = {
		preview: (image, publicKey) =>
			run(client.mutate.previewAppInstall({ __args: { image, publicKey } })),
		install: (granted: PermissionKey[]) => run(client.mutate.installApp({ __args: { granted } })),
		dismissPreview: () => run(client.mutate.dismissAppPreview()),
		uninstall: (appId) => run(client.mutate.uninstallApp({ __args: { appId } })),
		setEnabled: (appId, enabled) =>
			run(client.mutate.setAppEnabled({ __args: { appId, enabled } })),
		setAutoUpdate: (appId, autoUpdate) =>
			run(client.mutate.setAppAutoUpdate({ __args: { appId, autoUpdate } })),
		setPermission: (appId, permission, granted) =>
			run(client.mutate.setAppPermission({ __args: { appId, permission, granted } })),
		approveUpdate: (appId) => run(client.mutate.approveAppUpdate({ __args: { appId } })),
		rejectUpdate: (appId) => run(client.mutate.rejectAppUpdate({ __args: { appId } })),
		clearCache: (appId) => run(client.mutate.clearAppCache({ __args: { appId } })),
		clearStorage: (appId) => run(client.mutate.clearAppStorage({ __args: { appId } })),
		checkUpdates: () => run(client.mutate.checkAppUpdates())
	};
</script>

<svelte:head><title>{m.apps_page_title()}</title></svelte:head>

<div class="flex min-h-screen flex-col gap-6 bg-slate-950 px-8 py-10 text-white sm:px-12">
	<h1 class="text-2xl font-semibold">{m.apps_page_title()}</h1>

	{#if refusal}
		<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">
			{refusal}
		</p>
	{/if}

	<AppManagerPanel apps={managed} {actions} {suggested} />
</div>
