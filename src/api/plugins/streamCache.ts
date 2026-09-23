// Shared by the streaming proxy (src/routes/api/stream) and the playback
// metadata query (src/api/handlers/playback.ts) so a seek (which re-hits the
// proxy route with a new `t=`) doesn't re-invoke the plugin's own resolution
// (yt-dlp, for the YouTube plugin) every time -- that's a real few-hundred-ms
// cost, not free. Keyed by pluginId+sessionId since sessionId alone isn't
// guaranteed unique across plugins.
import type { ResolvedStream } from '#lib/plugins/host';
import type { PluginInstance } from './runtime';

const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { value: ResolvedStream; expiresAt: number }>();

export async function resolveStreamCached(
	pluginId: string,
	sessionId: string,
	plugin: PluginInstance,
	maxHeight?: number
): Promise<ResolvedStream> {
	// A quality change is a genuinely different resolved stream (different
	// URLs/codecs), not just a different offset into the same one, so it
	// needs its own cache entry rather than reusing whatever the last
	// resolution for this session happened to be.
	const key = `${pluginId}:${sessionId}:${maxHeight ?? 'auto'}`;
	const hit = cache.get(key);
	if (hit && hit.expiresAt > Date.now()) return hit.value;

	const value = await plugin.resolveStream(sessionId, maxHeight);
	cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
	return value;
}
