// Shared shape for a browsable video, used by both the TV-client browsing
// layer (tvHomeFeed.ts, tvSearch.ts) and the dashboard/screen builders in
// main.ts.
export type VideoSummary = {
	id: string;
	title: string;
	channelTitle: string;
	thumbnailUrl: string;
	// '' for a tile with no duration overlay at all (a livestream, mostly --
	// see tvTiles.ts's own comment on where this comes from).
	durationText: string;
};

const HIGH_RES_THUMBNAIL = 'maxresdefault.jpg';

/**
 * The image the host falls back to when a video thumbnail fails to load
 * (`fallbackImage`): maxresdefault 404s for videos without a high-res source,
 * mqdefault always exists and is still a 16:9 crop (see tvTiles.ts).
 */
export function thumbnailFallback(url: string): string | undefined {
	return url.endsWith(HIGH_RES_THUMBNAIL)
		? url.slice(0, -HIGH_RES_THUMBNAIL.length) + 'mqdefault.jpg'
		: undefined;
}

// A playlist as shown in the Playlists tab. `id` is the plain playlist id
// (no `VL` prefix), `thumbnailUrl` is '' when the tile carried none.
export type PlaylistSummary = {
	id: string;
	title: string;
	subtitle: string;
	thumbnailUrl: string;
};
