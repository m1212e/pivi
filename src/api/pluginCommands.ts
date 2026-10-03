// Plugin management, the protocol half: answers the phone's `plugins/*`
// notifications server-side and pushes state back to it — what's installed, what
// each plugin asks for and what the user has switched on, any update waiting for
// approval, and the preview of something about to be installed.
//
// Why the phone, and why it isn't a route: installing code and deciding what it
// may touch must only be possible over the paired, encrypted relay connection
// (src/api/ws/relay.ts), which is already the trust boundary for "this phone may
// drive this device". The TV's own page is an unauthenticated local browser; see
// wifiCommands.ts for the same reasoning applied to the network.
import {
	pluginIdParamsSchema,
	pluginsApproveUpdateNotification,
	pluginsCheckUpdatesNotification,
	pluginsClearCacheNotification,
	pluginsDismissPreviewNotification,
	pluginsInstallNotification,
	pluginsInstallParamsSchema,
	pluginsPreviewNotification,
	pluginsPreviewParamsSchema,
	pluginsRejectUpdateNotification,
	pluginsRequestStateNotification,
	pluginsSetAutoUpdateNotification,
	pluginsSetAutoUpdateParamsSchema,
	pluginsSetEnabledNotification,
	pluginsSetEnabledParamsSchema,
	pluginsSetPermissionNotification,
	pluginsSetPermissionParamsSchema,
	pluginsStateNotification,
	pluginsStateParamsSchema,
	pluginsUninstallNotification
} from '#lib/pairing/remoteProtocol';
import type { z } from 'zod';
import { getActiveProfileUser } from './activeProfile';
import { describePlugin } from './pluginState';
import { defaultPluginDeps } from './plugins/deps';
import {
	clearPluginCache,
	installPlugin,
	previewInstall,
	setPluginAutoUpdate,
	setPluginEnabled,
	setPluginPermission,
	uninstallPlugin
} from './plugins/installer';
import { PLUGIN_LIST_EVENT } from './plugins/events';
import { pluginPubSub } from './plugins/pubsub';
import { approvePendingUpdate, checkAllForUpdates, rejectPendingUpdate } from './plugins/updater';
import { registerPhoneFrameHandler, sendToPhones } from './ws/relay';

type PluginsState = z.infer<typeof pluginsStateParamsSchema>;

// Everything here that isn't derived from the database: what's in flight, the
// last failure, and the preview awaiting the user's decision. Kept server-side
// so a phone that reloads mid-install, or a second phone, sees the same thing as
// the one that started it.
const session: Pick<PluginsState, 'busy' | 'error' | 'preview'> = {
	busy: null,
	error: null,
	preview: null
};

async function pushState() {
	const rows = await defaultPluginDeps.store.list();
	sendToPhones({
		jsonrpc: '2.0',
		method: pluginsStateNotification.method,
		params: pluginsStateParamsSchema.parse({ plugins: rows.map(describePlugin), ...session })
	});
}

// What the TV's own pages list changes with the installed set too.
function announceChange() {
	pluginPubSub.publish(PLUGIN_LIST_EVENT);
}

// Runs one command: marks the host busy for its duration, turns a failure into
// state the phone can show (this runs on a socket message, where a rejection
// would have nowhere to go), and always ends by pushing the result.
async function run(busy: NonNullable<PluginsState['busy']>, action: () => Promise<void>) {
	session.busy = busy;
	session.error = null;
	await pushState().catch(() => {});

	try {
		await action();
	} catch (error) {
		session.error = error instanceof Error ? error.message : String(error);
	} finally {
		session.busy = null;
		announceChange();
		await pushState().catch(() => {});
	}
}

async function handlePreview(raw: unknown) {
	const request = pluginsPreviewParamsSchema.parse(raw);
	session.preview = null;
	await run('previewing', async () => {
		const preview = await previewInstall(defaultPluginDeps, request);
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
}

async function handleInstall(raw: unknown) {
	const request = pluginsInstallParamsSchema.parse(raw);
	await run('installing', async () => {
		await installPlugin(defaultPluginDeps, request);
		session.preview = null;
	});
}

async function handleClearCache(raw: unknown) {
	const { pluginId } = pluginIdParamsSchema.parse(raw);
	await run('working', async () => {
		const user = await getActiveProfileUser();
		if (!user) throw new Error('No profile is active');
		await clearPluginCache(defaultPluginDeps, pluginId, user.id);
	});
}

const withPluginId = (action: (pluginId: string) => Promise<void>) => (raw: unknown) =>
	run('working', () => action(pluginIdParamsSchema.parse(raw).pluginId));

const HANDLERS: Record<string, (params: unknown) => Promise<void>> = {
	[pluginsRequestStateNotification.method]: () => pushState(),
	[pluginsPreviewNotification.method]: handlePreview,
	[pluginsInstallNotification.method]: handleInstall,
	[pluginsDismissPreviewNotification.method]: async () => {
		session.preview = null;
		session.error = null;
		await pushState();
	},
	[pluginsUninstallNotification.method]: withPluginId((id) =>
		uninstallPlugin(defaultPluginDeps, id)
	),
	[pluginsApproveUpdateNotification.method]: withPluginId((id) =>
		approvePendingUpdate(defaultPluginDeps, id)
	),
	[pluginsRejectUpdateNotification.method]: withPluginId((id) =>
		rejectPendingUpdate(defaultPluginDeps, id)
	),
	[pluginsClearCacheNotification.method]: handleClearCache,
	[pluginsCheckUpdatesNotification.method]: () =>
		run('checking', async () => void (await checkAllForUpdates(defaultPluginDeps))),
	[pluginsSetEnabledNotification.method]: (raw) => {
		const { pluginId, enabled } = pluginsSetEnabledParamsSchema.parse(raw);
		return run('working', () => setPluginEnabled(defaultPluginDeps, pluginId, enabled));
	},
	[pluginsSetAutoUpdateNotification.method]: (raw) => {
		const { pluginId, autoUpdate } = pluginsSetAutoUpdateParamsSchema.parse(raw);
		return run('working', () => setPluginAutoUpdate(defaultPluginDeps, pluginId, autoUpdate));
	},
	[pluginsSetPermissionNotification.method]: (raw) => {
		const { pluginId, permission, granted } = pluginsSetPermissionParamsSchema.parse(raw);
		return run('working', () =>
			setPluginPermission(defaultPluginDeps, pluginId, permission, granted)
		);
	}
};

// Returning `true` consumes the frame so the relay doesn't forward it to the TV.
// A malformed frame is swallowed rather than thrown: this runs on a socket
// message, where a rejection has nowhere to go.
function handlePluginFrame(method: string, params: unknown): boolean {
	const handler = HANDLERS[method];
	if (!handler) return false;
	void handler(params).catch(() => {});
	return true;
}

/** Called once at startup (src/api/handlers/register.ts). */
export function startPluginCommands() {
	registerPhoneFrameHandler(handlePluginFrame);
}
