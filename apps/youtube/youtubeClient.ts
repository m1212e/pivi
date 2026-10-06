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

// A playlist as shown in the Playlists tab. `id` is the plain playlist id
// (no `VL` prefix), `thumbnailUrl` is '' when the tile carried none.
export type PlaylistSummary = {
	id: string;
	title: string;
	subtitle: string;
	thumbnailUrl: string;
};
