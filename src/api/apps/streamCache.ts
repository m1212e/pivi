// Shared by the streaming proxy (src/routes/api/stream) and the playback
// metadata query (src/api/handlers/playback.ts) so a seek (which re-hits the
// proxy route with a new `t=`) doesn't re-invoke the app's own resolution
// (yt-dlp, for the YouTube app) every time -- that's a real few-hundred-ms
// cost, not free. Keyed by appId+sessionId since sessionId alone isn't
// guaranteed unique across apps.
import type { ResolvedStream } from '#lib/apps/host';
import type { AppInstance } from './runtime';
import { assertPublicHost, UnsafeUrlError } from './urlGuard';

const TTL_MS = 5 * 60 * 1000;

// The host (ffmpeg, the stream proxy) fetches whatever URLs an app returns, so
// they're checked before anything is cached or handed on: each has to be on a
// domain the app declared and the user allowed, and to resolve to a public
// address — otherwise an app could point the host at the LAN or at its own
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

const cache = new Map<string, { value: ResolvedStream; expiresAt: number }>();
// Resolutions still running. The video and audio tracks and the player page ask
// for the same stream at once, and every extra yt-dlp in the app's small VM is
// a chance for the out-of-memory killer to take the whole app down.
const inFlight = new Map<string, Promise<ResolvedStream>>();

// An app that was restarted or had a permission revoked must not keep serving
// streams it resolved under the old terms.
export function dropStreamCache(appId: string): void {
	for (const key of cache.keys()) {
		if (key.startsWith(`${appId}:`)) cache.delete(key);
	}
}

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
	if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);

	const running = inFlight.get(key);
	if (running) return running;

	const resolution = (async () => {
		const value = await app.resolveStream(sessionId, maxHeight);
		await assertSafeStream(app, value);
		cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
		return value;
	})().finally(() => inFlight.delete(key));
	inFlight.set(key, resolution);
	return resolution;
}
