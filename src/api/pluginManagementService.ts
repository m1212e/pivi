// The logic of managing plugins, with everything it reaches for handed in. Installing, configuring and updating plugins, as one service that both UIs
// drive: the paired phone (over the relay, see pluginCommands.ts) and the TV's
// own screen (over GraphQL, see handlers/pluginManagement.ts, so apps can be
// managed with nothing but the remote's gestures). They share one state — what's
// installed, what's in flight, the last failure, the preview awaiting a decision
// — so whichever one starts something, the other sees it.
//
// The service only decides *what to do*; who is allowed to ask is the caller's
// business (the relay is the paired-phone trust boundary; the GraphQL side
// requires a paired phone to be connected).
import type { z } from 'zod';
import type { pluginsStateParamsSchema } from '#lib/pairing/remoteProtocol';
import type { PermissionKey } from '#lib/plugins/manifest';
import { describePlugin } from './pluginState';
import type { PluginDeps } from './plugins/deps';
import {
	clearPluginCache,
	installPlugin,
	previewInstall,
	setPluginAutoUpdate,
	setPluginEnabled,
	setPluginPermission,
	uninstallPlugin
} from './plugins/installer';
import { approvePendingUpdate, checkAllForUpdates, rejectPendingUpdate } from './plugins/updater';

export type PluginsState = z.infer<typeof pluginsStateParamsSchema>;
type Busy = NonNullable<PluginsState['busy']>;

export type ManagementEvents = {
	// The state shown to the user changed (busy, error, preview, or the installed set).
	stateChanged(): void;
	// The installed set changed: the TV's own lists and dashboards need refreshing.
	listChanged(): void;
};

type InstallRequest = { image: string; publicKey: string };

export function createPluginManagement(
	deps: PluginDeps,
	events: ManagementEvents,
	activeUserId: () => Promise<string | null>
) {
	// Everything here that isn't derived from the database: what's in flight, the
	// last failure, and the preview awaiting the user's decision. Kept server-side
	// so a screen that reloads mid-install, or a second one, sees the same thing
	// as the one that started it.
	const session: Pick<PluginsState, 'busy' | 'error' | 'preview'> = {
		busy: null,
		error: null,
		preview: null
	};

	// Runs one operation: marks the service busy for its duration, turns a failure
	// into state the UI can show, and always ends by announcing the result.
	async function run(busy: Busy, action: () => Promise<void>): Promise<void> {
		session.busy = busy;
		session.error = null;
		events.stateChanged();

		try {
			await action();
		} catch (error) {
			session.error = error instanceof Error ? error.message : String(error);
		} finally {
			session.busy = null;
			events.listChanged();
			events.stateChanged();
		}
	}

	const forPlugin = (action: (pluginId: string) => Promise<void>) => (pluginId: string) =>
		run('working', () => action(pluginId));

	return {
		async state(): Promise<PluginsState> {
			const rows = await deps.store.list();
			return { plugins: rows.map(describePlugin), ...session };
		},

		async preview(request: InstallRequest): Promise<void> {
			session.preview = null;
			await run('previewing', async () => {
				const preview = await previewInstall(deps, request);
				session.preview = {
					image: preview.image,
					name: preview.manifest.name,
					version: preview.manifest.version,
					features: preview.manifest.features,
					permissions: preview.manifest.permissions,
					domains: preview.manifest.network?.domains ?? [],
					signerFingerprint: preview.signer.fingerprint,
					conflict: preview.conflict
				};
			});
		},

		install: (request: InstallRequest & { granted: PermissionKey[] }) =>
			run('installing', async () => {
				await installPlugin(deps, request);
				session.preview = null;
			}),

		dismissPreview(): void {
			session.preview = null;
			session.error = null;
			events.stateChanged();
		},

		uninstall: forPlugin((id) => uninstallPlugin(deps, id)),
		approveUpdate: forPlugin((id) => approvePendingUpdate(deps, id)),
		rejectUpdate: forPlugin((id) => rejectPendingUpdate(deps, id)),

		setEnabled: (pluginId: string, enabled: boolean) =>
			run('working', () => setPluginEnabled(deps, pluginId, enabled)),

		setAutoUpdate: (pluginId: string, autoUpdate: boolean) =>
			run('working', () => setPluginAutoUpdate(deps, pluginId, autoUpdate)),

		setPermission: (pluginId: string, permission: PermissionKey, granted: boolean) =>
			run('working', () => setPluginPermission(deps, pluginId, permission, granted)),

		clearCache: (pluginId: string) =>
			run('working', async () => {
				const userId = await activeUserId();
				if (!userId) throw new Error('No profile is active');
				await clearPluginCache(deps, pluginId, userId);
			}),

		checkUpdates: () =>
			run('checking', async () => {
				await checkAllForUpdates(deps);
			})
	};
}
