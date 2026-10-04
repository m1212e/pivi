<script lang="ts">
	// Install and manage apps (plugins) from the TV itself, with nothing but the
	// remote's gestures: move focus with the trackpad, press to select, and type
	// into the focused field on the phone's keyboard. The same panel as the phone's
	// own sheet, over the same shared state — an install started on one shows up on
	// the other.
	import * as m from '#lib/paraglide/messages';
	import { onMount } from 'svelte';
	import type { z } from 'zod';
	import { graphQLErrorMessage } from '#lib/api/errors';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import PluginManagerPanel, {
		type PluginActions
	} from '#lib/components/PluginManagerPanel.svelte';
	import { pluginsStateParamsSchema } from '#lib/pairing/remoteProtocol';
	import type { PermissionKey } from '#lib/plugins/manifest';

	type PluginsState = z.infer<typeof pluginsStateParamsSchema>;

	const FIELDS = {
		plugins: {
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
			errorMessage: true
		},
		preview: {
			image: true,
			name: true,
			version: true,
			features: true,
			permissions: true,
			domains: true,
			signerFingerprint: true,
			conflict: true
		},
		busy: true,
		errorMessage: true
	} as const;

	const EMPTY: PluginsState = { plugins: [], preview: null, busy: null, error: null };

	// What liveQuery hands back is a memoized Proxy that's the same object on every
	// emission (see home/+page.svelte), so it's copied into plain data — and
	// checked against the shape the panel expects — before it becomes $state.
	type Fetched = Omit<PluginsState, 'error' | 'plugins'> & {
		errorMessage: string | null;
		plugins: (Omit<PluginsState['plugins'][number], 'error'> & { errorMessage: string | null })[];
	};

	// The GraphQL fields are `errorMessage` (a field called `error` would be thrown by
	// the generated client); the panel's shape calls them `error`.
	function toState(value: unknown): PluginsState | null {
		const { errorMessage, plugins, ...rest } = JSON.parse(JSON.stringify(value)) as Fetched;
		const parsed = pluginsStateParamsSchema.safeParse({
			...rest,
			error: errorMessage,
			plugins: plugins.map(({ errorMessage: error, ...plugin }) => ({ ...plugin, error }))
		});
		return parsed.success ? parsed.data : null;
	}

	const initial = await client.liveQuery.pluginManagement(FIELDS);
	// Not called `state`: a variable of that name makes `$state(...)` parse as a store
	// dereference of it.
	let managed = $state<PluginsState>((initial && toState(initial)) || EMPTY);

	// A mutation can be refused outright (no paired phone connected); anything that
	// goes wrong while the work runs arrives through the shared state instead.
	let refusal = $state<string | null>(null);

	onMount(() => {
		const subscription = client.liveQuery.pluginManagement(FIELDS).subscribe((value) => {
			const next = value && toState(value);
			if (next) managed = next;
		});
		return () => stopSubscription(subscription);
	});

	function run(request: Promise<unknown>) {
		refusal = null;
		request.catch((err: unknown) => (refusal = graphQLErrorMessage(err, m.plugins_refused())));
	}

	const actions: PluginActions = {
		preview: (image, publicKey) =>
			run(client.mutate.previewPluginInstall({ __args: { image, publicKey } })),
		install: (image, publicKey, granted: PermissionKey[]) =>
			run(client.mutate.installPlugin({ __args: { image, publicKey, granted } })),
		dismissPreview: () => run(client.mutate.dismissPluginPreview()),
		uninstall: (pluginId) => run(client.mutate.uninstallPlugin({ __args: { pluginId } })),
		setEnabled: (pluginId, enabled) =>
			run(client.mutate.setPluginEnabled({ __args: { pluginId, enabled } })),
		setAutoUpdate: (pluginId, autoUpdate) =>
			run(client.mutate.setPluginAutoUpdate({ __args: { pluginId, autoUpdate } })),
		setPermission: (pluginId, permission, granted) =>
			run(client.mutate.setPluginPermission({ __args: { pluginId, permission, granted } })),
		approveUpdate: (pluginId) => run(client.mutate.approvePluginUpdate({ __args: { pluginId } })),
		rejectUpdate: (pluginId) => run(client.mutate.rejectPluginUpdate({ __args: { pluginId } })),
		clearCache: (pluginId) => run(client.mutate.clearPluginCache({ __args: { pluginId } })),
		checkUpdates: () => run(client.mutate.checkPluginUpdates())
	};
</script>

<svelte:head><title>{m.plugins_page_title()}</title></svelte:head>

<div class="flex min-h-screen flex-col gap-6 bg-slate-950 px-8 py-10 text-white sm:px-12">
	<h1 class="text-2xl font-semibold">{m.plugins_page_title()}</h1>

	{#if refusal}
		<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">
			{refusal}
		</p>
	{/if}

	<div class="max-w-3xl">
		<PluginManagerPanel plugins={managed} {actions} />
	</div>
</div>
