import { buildSegmentBaseIndex, type SegmentBaseIndex } from './containerIndex';

const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { value: SegmentBaseIndex; expiresAt: number }>();

/**
 * What the stream-track index route uses so a reload or seek in the same
 * session doesn't re-download the CDN file's header to find its index again.
 * Keyed by url alone since a resolved CDN url always has the same container.
 */
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
