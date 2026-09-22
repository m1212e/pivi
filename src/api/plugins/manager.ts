// Lazily loads and caches the one plugin this prototype ships, the same
// way getOrCreateTvIdentity caches the TV keypair — a real system would
// have one of these per installed plugin, keyed by plugin id, started at
// server boot rather than on first request.
import { fileURLToPath } from 'node:url';
import { loadPlugin, type PluginInstance } from './runtime';
import { pluginPubSub } from './pubsub';

const YOUTUBE_ENTRY = fileURLToPath(new URL('../../../plugins/youtube/main.ts', import.meta.url));
const PLUGIN_ID = 'youtube';

let youtubePlugin: Promise<PluginInstance> | undefined;

export function getYoutubePlugin(): Promise<PluginInstance> {
	if (!youtubePlugin) {
		youtubePlugin = loadPlugin(YOUTUBE_ENTRY, (kind, screenId) => {
			pluginPubSub.publish(
				kind === 'screen' ? `${PLUGIN_ID}:screen:${screenId}` : `${PLUGIN_ID}:${kind}`
			);
		});
	}
	return youtubePlugin;
}
