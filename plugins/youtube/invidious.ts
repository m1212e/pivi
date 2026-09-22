// Browse/search data source for the YouTube plugin, via a self-hosted
// Invidious instance (see docker-compose.yaml) instead of talking to
// InnerTube directly. Direct InnerTube browse/search calls turned out not
// to work for a signed-in session: the WEB client rejects our OAuth-only
// auth (no cookie) with a 400, and the one client that does accept OAuth
// (TV) returns responses in a shape nothing in youtubei.js can parse — see
// the investigation in SKETCH.md's YouTube plugin notes. Invidious already
// does that reverse-engineering itself and exposes a plain REST API, so
// this plugin uses that for browsing instead of re-solving the same problem.
import type { VideoSummary } from './youtubeClient';

const BASE_URL = process.env.INVIDIOUS_URL ?? 'http://localhost:3000';

// Invidious's own video object shape (api/v1/search, api/v1/trending,
// api/v1/popular all return this) — only the fields this plugin actually
// displays are declared here.
type InvidiousVideo = {
	videoId: string;
	title: string;
	author: string;
	videoThumbnails?: { url: string; quality: string }[];
};

// Highest-to-lowest — the same "image" field now also backs the dashboard's
// full-bleed hero banner, not just small shelf cards, so this reaches for
// the best resolution Invidious actually reports rather than a fixed
// "medium". "sddefault"/"high" (hqdefault) are deliberately skipped even
// though they're higher-res than "medium": both are a fixed 4:3 canvas
// letterboxed with real black bars for any widescreen video, which a
// top-anchored crop (the hero banner) then shows as a solid black band —
// "maxres"/"medium" (mqdefault) are genuine 16:9 crops with no letterbox.
const QUALITY_PRIORITY = ['maxres', 'maxresdefault', 'medium'];

function toSummary(video: InvidiousVideo): VideoSummary {
	const thumbnail =
		QUALITY_PRIORITY.map((quality) =>
			video.videoThumbnails?.find((t) => t.quality === quality)
		).find((t) => t !== undefined) ?? video.videoThumbnails?.[0];
	// Invidious proxies thumbnails itself (privacy — no direct requests to
	// Google's CDN) and returns them as paths relative to its own origin,
	// not absolute URLs. The dashboard/screen renderer is on a different
	// origin, so these need the Invidious base URL prefixed on or the
	// browser resolves them against the wrong host and 404s.
	return {
		id: video.videoId,
		title: video.title,
		channelTitle: video.author,
		thumbnailUrl: thumbnail ? `${BASE_URL}${thumbnail.url}` : ''
	};
}

async function get(path: string): Promise<unknown> {
	const response = await fetch(`${BASE_URL}${path}`);
	if (!response.ok) {
		throw new Error(`Invidious request to ${path} failed with status ${response.status}`);
	}
	return response.json();
}

export async function searchVideos(query: string): Promise<VideoSummary[]> {
	const results = (await get(
		`/api/v1/search?q=${encodeURIComponent(query)}&type=video`
	)) as InvidiousVideo[];
	return results.slice(0, 10).map(toSummary);
}

export async function fetchTrending(): Promise<VideoSummary[]> {
	const results = (await get('/api/v1/trending')) as InvidiousVideo[];
	return results.slice(0, 10).map(toSummary);
}
