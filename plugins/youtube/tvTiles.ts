// Shared "walk a raw TV InnerTube response for video tiles" logic --
// tvHomeFeed.ts and tvSearch.ts call different endpoints but both get back
// the same tileRenderer-shaped response, so this is one place to parse it
// instead of two.
import type { VideoSummary } from './youtubeClient';

// Recursively finds every "tile" (TV's video-card renderer) anywhere in the
// response, regardless of which shelf/section it's nested under. Robust to
// the exact section layout changing, since all that's actually needed is
// "every video tile on the page", not the shelf structure around it.
function findTiles(node: unknown, out: Record<string, unknown>[]): void {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const item of node) findTiles(item, out);
		return;
	}
	const obj = node as Record<string, unknown>;
	if (obj.tileRenderer && typeof obj.tileRenderer === 'object') {
		out.push(obj.tileRenderer as Record<string, unknown>);
	}
	for (const value of Object.values(obj)) findTiles(value, out);
}

type Tile = {
	contentId?: string;
	contentType?: string;
	header?: { tileHeaderRenderer?: { thumbnail?: { thumbnails?: { url: string }[] } } };
	metadata?: {
		tileMetadataRenderer?: {
			title?: { simpleText?: string };
			lines?: {
				lineRenderer?: {
					items?: { lineItemRenderer?: { text?: { runs?: { text?: string }[] } } }[];
				};
			}[];
		};
	};
};

function tileToSummary(tile: Tile): VideoSummary | null {
	if (!tile.contentId || tile.contentType !== 'TILE_CONTENT_TYPE_VIDEO') return null;

	const meta = tile.metadata?.tileMetadataRenderer;
	// The channel name is whichever line's first item is plain text runs
	// rather than a badge/view-count/date — those share the same lineRenderer
	// shape but carry a `badge` instead of `text`, so this just takes the
	// first line that actually has text.
	const channelTitle =
		meta?.lines
			?.map((line) => line.lineRenderer?.items?.[0]?.lineItemRenderer?.text?.runs?.[0]?.text)
			.find((text): text is string => !!text) ?? '';

	return {
		id: tile.contentId,
		title: meta?.title?.simpleText ?? 'Untitled',
		channelTitle,
		// TV tile widgets only carry thumbnails sized for their own small
		// on-screen tiles (a few hundred px wide at most) — nowhere near
		// enough for the dashboard's full-bleed hero banner, which also uses
		// this same field. Built directly instead: this account is already
		// talking straight to Google, so there's no privacy tradeoff in also
		// fetching thumbnails from Google's own CDN.
		//
		// maxresdefault is a genuine 16:9 crop, but 404s for videos with no
		// high-res source — sddefault/hqdefault always exist but are a fixed
		// 4:3 canvas letterboxed (real black bars baked into the jpeg) for
		// any widescreen video, which a top-anchored crop (the hero banner)
		// then displays as a solid black band. mqdefault is the fallback:
		// always generated and genuinely 16:9, just lower-res.
		thumbnailUrl: `https://i.ytimg.com/vi/${tile.contentId}/maxresdefault.jpg`
	};
}

// Flattens every tile found anywhere in a raw TV response into a deduped
// list, capped at `limit`. Dedup matters because the same video can
// legitimately appear in more than one shelf/section (harmless for a real
// TV UI, which renders each shelf separately, but downstream UI here keys
// each item by video id, which breaks on a duplicate).
export function collectTiles(root: unknown, limit: number): VideoSummary[] {
	const tiles: Record<string, unknown>[] = [];
	findTiles(root, tiles);

	const seen = new Set<string>();
	const results: VideoSummary[] = [];
	for (const tile of tiles) {
		const summary = tileToSummary(tile as Tile);
		if (!summary || seen.has(summary.id)) continue;
		seen.add(summary.id);
		results.push(summary);
		if (results.length >= limit) break;
	}
	return results;
}
