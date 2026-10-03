// Shared by the streaming proxy (src/routes/api/stream) and the playback
// metadata query (src/api/handlers/playback.ts) so a seek (which re-hits the
// proxy route with a new `t=`) doesn't re-invoke the plugin's own resolution
// (yt-dlp, for the YouTube plugin) every time -- that's a real few-hundred-ms
// cost, not free. Keyed by pluginId+sessionId since sessionId alone isn't
// guaranteed unique across plugins.
import type { ResolvedStream } from '#lib/plugins/host';
import type { PluginInstance } from './runtime';
import { assertPublicHost, UnsafeUrlError } from './urlGuard';

const TTL_MS = 5 * 60 * 1000;

// The host (ffmpeg, the stream proxy) fetches whatever URLs a plugin returns, so
// they're checked before anything is cached or handed on: each has to be on a
// domain the plugin declared and the user allowed, and to resolve to a public
// address — otherwise a plugin could point the host at the LAN or at its own
// services.
async function assertSafeStream(plugin: PluginInstance, stream: ResolvedStream): Promise<void> {
	const urls = [
		stream.videoUrl,
		...(stream.audioUrl ? [stream.audioUrl] : []),
		...(stream.subtitleTracks ?? []).map((track) => track.url)
	];
	for (const url of urls) {
		if (!plugin.allowsUrl(url)) {
			throw new UnsafeUrlError(`${plugin.manifest.id} returned a URL outside its allowed domains`);
		}
		await assertPublicHost(new URL(url).hostname);
	}
}

const cache = new Map<string, { value: ResolvedStream; expiresAt: number }>();

// A plugin that was restarted or had a permission revoked must not keep serving
// streams it resolved under the old terms.
export function dropStreamCache(pluginId: string): void {
	for (const key of cache.keys()) {
		if (key.startsWith(`${pluginId}:`)) cache.delete(key);
	}
}

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
	await assertSafeStream(plugin, value);
	cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
	return value;
}
