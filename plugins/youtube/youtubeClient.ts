// Shared shape for a browsable video, used by both the TV-client browsing
// layer (tvHomeFeed.ts, tvSearch.ts) and the dashboard/screen builders in
// main.ts.
export type VideoSummary = {
	id: string;
	title: string;
	channelTitle: string;
	thumbnailUrl: string;
};
