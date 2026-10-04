// The plugin management service wired to the real database, registry and sandbox
// (see pluginManagementService.ts for what it does and who may ask).
import { getActiveProfileUser } from './activeProfile';
import { createPluginManagement } from './pluginManagementService';
import { defaultPluginDeps } from './plugins/deps';
import { announcePluginListChanged, PLUGIN_MANAGEMENT_EVENT } from './plugins/events';
import { pluginPubSub } from './plugins/pubsub';

export const pluginManagement = createPluginManagement(
	defaultPluginDeps,
	{
		stateChanged: () => pluginPubSub.publish(PLUGIN_MANAGEMENT_EVENT),
		listChanged: announcePluginListChanged
	},
	async () => (await getActiveProfileUser())?.id ?? null
);
