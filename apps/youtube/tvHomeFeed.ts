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
import { collectTiles } from './tvTiles';

export async function fetchTvHomeFeed(innertube: Innertube): Promise<VideoSummary[]> {
	const endpoint = new YTNodes.NavigationEndpoint({
		browseEndpoint: { browseId: 'FEwhat_to_watch' }
	});
	const response = (await endpoint.call(innertube.actions, { client: 'TV' })) as { data: unknown };
	return collectTiles(response.data, 15);
}
