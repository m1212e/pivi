// Plugin management for the paired phone: answers its `plugins/*` notifications
// by calling the shared service (pluginManagement.ts) and pushes the state back
// to it whenever that changes — including when the TV's own screen made the
// change, so the two never disagree.
//
// Why the phone has this over the relay rather than as a route: installing code
// and deciding what it may touch must be possible over the paired, encrypted
// connection (src/api/ws/relay.ts), which is already the trust boundary for
// "this phone may drive this device". See wifiCommands.ts for the same
// reasoning applied to the network.
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
import { pluginManagement } from './pluginManagement';
import { PLUGIN_MANAGEMENT_EVENT } from './plugins/events';
import { pluginPubSub } from './plugins/pubsub';
import { registerPhoneFrameHandler, sendToPhones } from './ws/relay';

async function pushState() {
	sendToPhones({
		jsonrpc: '2.0',
		method: pluginsStateNotification.method,
		params: pluginsStateParamsSchema.parse(await pluginManagement.state())
	});
}

const withPluginId = (action: (pluginId: string) => Promise<void>) => (raw: unknown) =>
	action(pluginIdParamsSchema.parse(raw).pluginId);

const HANDLERS: Record<string, (params: unknown) => Promise<void> | void> = {
	[pluginsRequestStateNotification.method]: () => pushState(),
	[pluginsPreviewNotification.method]: (raw) =>
		pluginManagement.preview(pluginsPreviewParamsSchema.parse(raw)),
	[pluginsInstallNotification.method]: (raw) =>
		pluginManagement.install(pluginsInstallParamsSchema.parse(raw)),
	[pluginsDismissPreviewNotification.method]: () => pluginManagement.dismissPreview(),
	[pluginsUninstallNotification.method]: withPluginId(pluginManagement.uninstall),
	[pluginsApproveUpdateNotification.method]: withPluginId(pluginManagement.approveUpdate),
	[pluginsRejectUpdateNotification.method]: withPluginId(pluginManagement.rejectUpdate),
	[pluginsClearCacheNotification.method]: withPluginId(pluginManagement.clearCache),
	[pluginsCheckUpdatesNotification.method]: () => pluginManagement.checkUpdates(),
	[pluginsSetEnabledNotification.method]: (raw) => {
		const { pluginId, enabled } = pluginsSetEnabledParamsSchema.parse(raw);
		return pluginManagement.setEnabled(pluginId, enabled);
	},
	[pluginsSetAutoUpdateNotification.method]: (raw) => {
		const { pluginId, autoUpdate } = pluginsSetAutoUpdateParamsSchema.parse(raw);
		return pluginManagement.setAutoUpdate(pluginId, autoUpdate);
	},
	[pluginsSetPermissionNotification.method]: (raw) => {
		const { pluginId, permission, granted } = pluginsSetPermissionParamsSchema.parse(raw);
		return pluginManagement.setPermission(pluginId, permission, granted);
	}
};

// Returning `true` consumes the frame so the relay doesn't forward it to the TV.
// A malformed frame is swallowed rather than thrown: this runs on a socket
// message, where a rejection has nowhere to go.
function handlePluginFrame(method: string, params: unknown): boolean {
	const handler = HANDLERS[method];
	if (!handler) return false;
	void Promise.resolve()
		.then(() => handler(params))
		.catch(() => {});
	return true;
}

declare global {
	var __piviPluginCommandsStarted: boolean | undefined;
}

/** Called once at startup (src/api/handlers/register.ts). */
export function startPluginCommands() {
	if (globalThis.__piviPluginCommandsStarted) return;
	globalThis.__piviPluginCommandsStarted = true;

	registerPhoneFrameHandler(handlePluginFrame);

	// Whatever changes the state — this phone, another, or the TV's own screen —
	// every paired phone is told.
	void (async () => {
		const changes = pluginPubSub.subscribe(PLUGIN_MANAGEMENT_EVENT);
		for await (const change of changes) {
			void change;
			await pushState().catch(() => {});
		}
	})();
}
