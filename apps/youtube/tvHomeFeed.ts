// The actual personalized "recommended for you" YouTube home feed, tied to
// the signed-in account.
//
// OAuth2 (auth.ts's device-code flow) is documented to only work with the
// TV InnerTube client (ytjs.dev's own auth guide says so outright) — the
// WEB client 400s on OAuth-only auth. Feeding an OAuth session's TV-client
// browse request through youtubei.js's own typed result classes (YT.HomeFeed)
// doesn't work either: those are written for WEB's renderer shapes and choke
// on TV's (confirmed earlier trying ANDROID the same way). But the raw TV
// response turned out to be a plain, readable JSON tree — clear field names,
// no obfuscation — so this walks it directly instead (tvTiles.ts) instead
// of needing typed classes.
import { YTNodes } from 'youtubei.js';
import type { Innertube } from 'youtubei.js';
import type { VideoSummary } from './youtubeClient';
import { collectTiles, findContinuationToken } from './tvTiles';
import { browseTvMore } from './tvLibrary';

// A page is everything the response holds: cutting it off would skip the tiles
// the continuation token already points past.
const PAGE_LIMIT = 1000;

export type FeedPage = {
	videos: VideoSummary[];
	// Pass to fetchTvHomeMore for the next page, undefined when there is none.
	continuation?: string;
};

function toPage(data: unknown): FeedPage {
	return { videos: collectTiles(data, PAGE_LIMIT), continuation: findContinuationToken(data) };
}

export async function fetchTvHomeFeed(innertube: Innertube): Promise<FeedPage> {
	const endpoint = new YTNodes.NavigationEndpoint({
		browseEndpoint: { browseId: 'FEwhat_to_watch' }
	});
	const response = (await endpoint.call(innertube.actions, { client: 'TV' })) as { data: unknown };
	return toPage(response.data);
}

export async function fetchTvHomeMore(
	innertube: Innertube,
	continuation: string
): Promise<FeedPage> {
	return toPage(await browseTvMore(innertube, continuation));
}
