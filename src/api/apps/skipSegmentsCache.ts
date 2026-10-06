import type { SkipSegment } from '#lib/apps/host';
import type { AppInstance } from './runtime';

const TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, { value: SkipSegment[]; expiresAt: number }>();

/**
 * Backs the player's skip segments query (handlers/playback.ts). Asking the app
 * means a network round trip on its side (SponsorBlock for YouTube), and the
 * answer never changes with quality, so one entry per session is enough.
 */
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
