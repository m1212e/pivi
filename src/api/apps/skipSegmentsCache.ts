// Mirrors streamCache.ts's own reasoning: an app's skip-segment source
// (SponsorBlock, for YouTube) is a real network round trip, and unlike a
// stream resolution this never varies by quality, so every request for the
// same session shares one cache entry.
import type { SkipSegment } from '#lib/apps/host';
import type { AppInstance } from './runtime';

const TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, { value: SkipSegment[]; expiresAt: number }>();

export async function resolveSkipSegmentsCached(
	appId: string,
	sessionId: string,
	app: AppInstance
): Promise<SkipSegment[]> {
	const key = `${appId}:${sessionId}`;
	const hit = cache.get(key);
	if (hit && hit.expiresAt > Date.now()) return hit.value;

	const value = await app.resolveSkipSegments(sessionId);
	cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
	return value;
}
