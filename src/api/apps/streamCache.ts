import type { ResolvedStream } from '#lib/apps/host';
import type { AppInstance } from './runtime';
import { createTtlCache } from './ttlCache';
import { assertPublicHost, UnsafeUrlError } from './urlGuard';

// The host (ffmpeg, the stream proxy) fetches whatever URLs an app returns, so
// they're checked before anything is cached or handed on: each has to be on a
// domain the app declared and the user allowed, and to resolve to a public
// address. Otherwise an app could point the host at the LAN or at its own
// services.
async function assertSafeStream(app: AppInstance, stream: ResolvedStream): Promise<void> {
	const urls = [
		stream.videoUrl,
		...(stream.audioUrl ? [stream.audioUrl] : []),
		...(stream.subtitleTracks ?? []).map((track) => track.url)
	];
	for (const url of urls) {
		if (!app.allowsUrl(url)) {
			throw new UnsafeUrlError(`${app.manifest.id} returned a URL outside its allowed domains`);
		}
		await assertPublicHost(new URL(url).hostname);
	}
}

const cache = createTtlCache<ResolvedStream>(5 * 60 * 1000);
// Resolutions still running. The video and audio tracks and the player page ask
// for the same stream at once, and every extra yt-dlp in the app's small VM is
// a chance for the out-of-memory killer to take the whole app down.
const inFlight = new Map<string, Promise<ResolvedStream>>();

/**
 * Called by manager.ts whenever an app stops, so a restarted app or one with a
 * revoked permission doesn't keep serving streams resolved under the old terms.
 */
export function dropStreamCache(appId: string): void {
	cache.deletePrefix(`${appId}:`);
}

/**
 * The one way the stream routes and the playback query get a session's stream,
 * so the url checks always apply. Resolving runs yt-dlp inside the app, which
 * is too slow to repeat on every seek.
 */
export function resolveStreamCached(
	appId: string,
	sessionId: string,
	app: AppInstance,
	maxHeight?: number
): Promise<ResolvedStream> {
	// A quality change is a genuinely different resolved stream (different
	// URLs/codecs), not just a different offset into the same one, so it
	// needs its own cache entry rather than reusing whatever the last
	// resolution for this session happened to be.
	const key = `${appId}:${sessionId}:${maxHeight ?? 'auto'}`;
	const hit = cache.get(key);
	if (hit) return Promise.resolve(hit);

	const running = inFlight.get(key);
	if (running) return running;

	const resolution = (async () => {
		const value = await app.resolveStream(sessionId, maxHeight);
		await assertSafeStream(app, value);
		cache.set(key, value);
		return value;
	})().finally(() => inFlight.delete(key));
	inFlight.set(key, resolution);
	return resolution;
}
