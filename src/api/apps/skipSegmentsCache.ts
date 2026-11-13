import type { SkipSegment } from '#sdk/protocol';
import type { AppInstance } from './runtime';
import { createTtlCache } from './ttlCache';

const cache = createTtlCache<SkipSegment[]>(30 * 60 * 1000);

/**
 * Backs the player's skip segments query (handlers/playback.ts). Asking the app
 * usually means a network round trip on its side, and the
 * answer never changes with quality, so one entry per session is enough.
 */
export async function resolveSkipSegmentsCached(
	appId: string,
	sessionId: string,
	app: AppInstance
): Promise<SkipSegment[]> {
	const key = `${appId}:${sessionId}`;
	const hit = cache.get(key);
	if (hit) return hit;

	const value = await app.resolveSkipSegments(sessionId);
	cache.set(key, value);
	return value;
}
