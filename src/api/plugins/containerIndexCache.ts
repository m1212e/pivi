// Same rationale as streamCache.ts: locating the sidx/Cues index means an
// extra round trip to the CDN, so a reload or seek within the same session
// shouldn't redo it every time.
import { buildSegmentBaseIndex, type SegmentBaseIndex } from './containerIndex';

const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { value: SegmentBaseIndex; expiresAt: number }>();

export async function buildSegmentBaseIndexCached(
	url: string,
	container: 'mp4' | 'webm'
): Promise<SegmentBaseIndex> {
	const hit = cache.get(url);
	if (hit && hit.expiresAt > Date.now()) return hit.value;

	const value = await buildSegmentBaseIndex(url, container);
	cache.set(url, { value, expiresAt: Date.now() + TTL_MS });
	return value;
}
