import { buildSegmentBaseIndex, type SegmentBaseIndex } from './containerIndex';
import { createTtlCache } from './ttlCache';

const cache = createTtlCache<SegmentBaseIndex>(5 * 60 * 1000);

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
	if (hit) return hit;

	const value = await buildSegmentBaseIndex(url, container);
	cache.set(url, value);
	return value;
}
