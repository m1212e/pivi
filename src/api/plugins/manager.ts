// Lazily loads and caches every installed plugin, keyed by plugin id, the
// same way getOrCreateTvIdentity caches the TV keypair. A real system would
// discover this list (and start each one at server boot rather than on
// first request) instead of a hardcoded entry per plugin — out of scope
// until there's a second plugin to prove that discovery mechanism against.
import { fileURLToPath } from 'node:url';
import { loadPlugin, type PluginInstance } from './runtime';
import { pluginPubSub } from './pubsub';
import { onActiveProfileChanged } from '../activeProfile';

const PLUGIN_ENTRIES: Record<string, string> = {
	youtube: fileURLToPath(new URL('../../../plugins/youtube/main.ts', import.meta.url))
};

const instances = new Map<string, Promise<PluginInstance>>();

function spawnPlugin(pluginId: string, entryPath: string): Promise<PluginInstance> {
	return loadPlugin(entryPath, (kind, screenId) => {
		pluginPubSub.publish(
			kind === 'screen' ? `${pluginId}:screen:${screenId}` : `${pluginId}:${kind}`
		);
	});
}

export function getPlugin(pluginId: string): Promise<PluginInstance> {
	const entry = PLUGIN_ENTRIES[pluginId];
	if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);

	let instance = instances.get(pluginId);
	if (!instance) {
		instance = spawnPlugin(pluginId, entry);
		instances.set(pluginId, instance);
	}
	return instance;
}

// Kept for the existing YouTube-specific GraphQL handlers (dashboard/auth/
// screen/uiEvent) so they don't need touching just to go through the
// generic registry above.
export function getYoutubePlugin(): Promise<PluginInstance> {
	return getPlugin('youtube');
}

// Killing and respawning every running plugin process on every profile
// switch, rather than trusting each one to selectively reset whatever
// in-memory state it happens to hold (an innertube session, cached feed
// results, screens, pending auth...), is the only way to actually guarantee
// none of it survives into the next profile's session -- individually
// resetting each variable is exactly the kind of thing that's easy to miss
// (see plugins/youtube/main.ts's lastResults history). This only tears down
// the in-memory plugin processes; persisted state (credentials, keyed per
// user, in credentials.ts) is untouched.
onActiveProfileChanged(() => {
	const dying = [...instances.values()];
	instances.clear();
	for (const instance of dying) {
		instance.then((plugin) => plugin.dispose()).catch(() => {});
	}
});
