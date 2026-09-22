// Search, via the same "raw TV client response" trick tvHomeFeed.ts uses for
// browsing: youtubei.js's own Innertube.search() is hardcoded to the WEB
// client, which 400s on our OAuth-only (cookie-less) session the same way
// WEB browse endpoints do. A raw searchEndpoint called with { client: 'TV' }
// comes back in the same tileRenderer shape the home feed does, so this
// reuses tvTiles.ts's parser instead of needing a separate REST backend.
import { YTNodes } from 'youtubei.js';
import type { Innertube } from 'youtubei.js';
import type { VideoSummary } from './youtubeClient';
import { collectTiles } from './tvTiles';

export async function searchTv(innertube: Innertube, query: string): Promise<VideoSummary[]> {
	const endpoint = new YTNodes.NavigationEndpoint({ searchEndpoint: { query } });
	const response = (await endpoint.call(innertube.actions, { client: 'TV' })) as { data: unknown };
	return collectTiles(response.data, 10);
}
