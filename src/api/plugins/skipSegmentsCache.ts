// Mirrors streamCache.ts's own reasoning: a plugin's skip-segment source
// (SponsorBlock, for YouTube) is a real network round trip, and unlike a
// stream resolution this never varies by quality, so every request for the
// same session shares one cache entry.
import type { SkipSegment } from '#lib/plugins/host';
import type { PluginInstance } from './runtime';

const TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, { value: SkipSegment[]; expiresAt: number }>();

export async function resolveSkipSegmentsCached(
	pluginId: string,
	sessionId: string,
	plugin: PluginInstance
): Promise<SkipSegment[]> {
	const key = `${pluginId}:${sessionId}`;
	const hit = cache.get(key);
	if (hit && hit.expiresAt > Date.now()) return hit.value;

	const value = await plugin.resolveSkipSegments(sessionId);
	cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
	return value;
}
