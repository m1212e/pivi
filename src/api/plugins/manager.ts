// Lazily loads and caches the one plugin this prototype ships, the same
// way getOrCreateTvIdentity caches the TV keypair — a real system would
// have one of these per installed plugin, keyed by plugin id, started at
// server boot rather than on first request.
import { fileURLToPath } from 'node:url';
import { loadPlugin, type PluginInstance } from './runtime';
import { pluginPubSub } from './pubsub';
import { onActiveProfileChanged } from '../activeProfile';

const YOUTUBE_ENTRY = fileURLToPath(new URL('../../../plugins/youtube/main.ts', import.meta.url));
const PLUGIN_ID = 'youtube';

let youtubePlugin: Promise<PluginInstance> | undefined;

function spawnYoutubePlugin(): Promise<PluginInstance> {
	return loadPlugin(YOUTUBE_ENTRY, (kind, screenId) => {
		pluginPubSub.publish(
			kind === 'screen' ? `${PLUGIN_ID}:screen:${screenId}` : `${PLUGIN_ID}:${kind}`
		);
	});
}

export function getYoutubePlugin(): Promise<PluginInstance> {
	if (!youtubePlugin) youtubePlugin = spawnYoutubePlugin();
	return youtubePlugin;
}

// Killing and respawning the whole process on every profile switch, rather
// than trusting the plugin to selectively reset whatever in-memory state it
// happens to hold (its innertube session, cached feed results, screens,
// pending auth...), is the only way to actually guarantee none of it survives
// into the next profile's session -- individually resetting each variable is
// exactly the kind of thing that's easy to miss (see plugins/youtube/main.ts's
// lastResults history). This only tears down the in-memory plugin process;
// persisted state (credentials, keyed per user, in credentials.ts) is
// untouched.
onActiveProfileChanged(() => {
	const dying = youtubePlugin;
	youtubePlugin = undefined;
	dying?.then((plugin) => plugin.dispose()).catch(() => {});
});
