// Shared "walk a raw TV InnerTube response for video tiles" logic --
// tvHomeFeed.ts and tvLibrary.ts call different endpoints but both get back
// the same tileRenderer-shaped response, so this is one place to parse it
// instead of two. Search answers in another shape, see tvSearch.ts.
import type { PlaylistSummary, VideoSummary } from './youtubeClient';

// Recursively finds every "tile" (TV's video-card renderer) anywhere in the
// response, regardless of which shelf/section it's nested under. Robust to
// the exact section layout changing, since all that's actually needed is
// "every video tile on the page", not the shelf structure around it.
function isTileRenderer(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object';
}

function findTilesInObject(obj: Record<string, unknown>, out: Record<string, unknown>[]): void {
	if (isTileRenderer(obj.tileRenderer)) out.push(obj.tileRenderer);
	for (const value of Object.values(obj)) findTiles(value, out);
}

function findTilesInArray(items: unknown[], out: Record<string, unknown>[]): void {
	for (const item of items) findTiles(item, out);
}

function findTiles(node: unknown, out: Record<string, unknown>[]): void {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) return findTilesInArray(node, out);
	findTilesInObject(node as Record<string, unknown>, out);
}

type Tile = {
	contentId?: string;
	contentType?: string;
	header?: {
		tileHeaderRenderer?: {
			thumbnail?: { thumbnails?: { url: string }[] };
			// The duration pill burned into the corner of every real TV
			// tile's thumbnail (this same renderer shows up identically on
			// desktop/mobile tiles too -- it's a generic InnerTube thumbnail
			// overlay, not something TV-specific). A livestream/premiere has
			// no overlay here at all rather than a 'LIVE' one in this shape.
			thumbnailOverlays?: {
				thumbnailOverlayTimeStatusRenderer?: { text?: { simpleText?: string } };
			}[];
		};
	};
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

type TileLines = {
	lineRenderer?: {
		items?: { lineItemRenderer?: { text?: { runs?: { text?: string }[] } } }[];
	};
}[];

// The channel name is whichever line's first item is plain text runs rather
// than a badge/view-count/date — those share the same lineRenderer shape but
// carry a `badge` instead of `text`, so this just takes the first line that
// actually has text.
function firstLineText(lines: TileLines | undefined): string {
	return (
		lines
			?.map((line) => line.lineRenderer?.items?.[0]?.lineItemRenderer?.text?.runs?.[0]?.text)
			.find((text): text is string => !!text) ?? ''
	);
}

function tileMetadataOf(tile: Tile) {
	return tile.metadata?.tileMetadataRenderer;
}

function titleOf(meta: ReturnType<typeof tileMetadataOf>): string {
	return meta?.title?.simpleText ?? 'Untitled';
}

function durationTextOf(tile: Tile): string {
	const overlays = tile.header?.tileHeaderRenderer?.thumbnailOverlays ?? [];
	for (const overlay of overlays) {
		const text = overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText;
		if (text) return text;
	}
	return '';
}

// This path was only confirmed against an ad tile from a signed-out TV
// search response (the real, signed-in "what to watch" home feed couldn't be
// probed without a live account) -- an ad reuses the same tileRenderer shape
// as an organic result, but if real home-feed tiles turn out to carry the
// duration somewhere else, this logs the first miss once so that's visible
// in the app's own log stream (stderr, captured by the host) instead of
// silently rendering every card with no badge.
let loggedMissingDuration = false;
function warnIfDurationMissing(tile: Tile, summary: VideoSummary) {
	if (summary.durationText || loggedMissingDuration) return;
	loggedMissingDuration = true;
	console.error(
		`[warn] no thumbnailOverlayTimeStatusRenderer on tile ${summary.id} -- header: ${JSON.stringify(tile.header)}`
	);
}

function tileToSummary(tile: Tile): VideoSummary | null {
	if (!tile.contentId || tile.contentType !== 'TILE_CONTENT_TYPE_VIDEO') return null;

	const meta = tileMetadataOf(tile);

	const summary: VideoSummary = {
		id: tile.contentId,
		title: titleOf(meta),
		channelTitle: firstLineText(meta?.lines),
		durationText: durationTextOf(tile),
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
	warnIfDurationMissing(tile, summary);
	return summary;
}

// Flattens every tile found anywhere in a raw TV response into a deduped
// list, capped at `limit`. Dedup matters because the same video can
// legitimately appear in more than one shelf/section (harmless for a real
// TV UI, which renders each shelf separately, but downstream UI here keys
// each item by video id, which breaks on a duplicate).
// Adds `tile`'s summary to `results` if it's a real, not-yet-seen video tile.
// Returns whether `results` has now hit `limit`, so the caller knows to stop.
function addUniqueTile(
	tile: Tile,
	seen: Set<string>,
	results: VideoSummary[],
	limit: number
): boolean {
	const summary = tileToSummary(tile);
	if (!summary || seen.has(summary.id)) return false;
	seen.add(summary.id);
	results.push(summary);
	return results.length >= limit;
}

export function collectTiles(root: unknown, limit: number): VideoSummary[] {
	const tiles: Record<string, unknown>[] = [];
	findTiles(root, tiles);

	const seen = new Set<string>();
	const results: VideoSummary[] = [];
	for (const tile of tiles) {
		if (addUniqueTile(tile as Tile, seen, results, limit)) break;
	}
	return results;
}

// The Playlists tab's tiles use the same renderer as videos, just with a
// playlist content type and the playlist id as contentId. Some responses
// prefix that id with `VL` (the browse id form), so it's stripped to keep one
// canonical id.
function tileToPlaylist(tile: Tile): PlaylistSummary | null {
	if (!tile.contentId || tile.contentType !== 'TILE_CONTENT_TYPE_PLAYLIST') return null;

	const meta = tileMetadataOf(tile);
	const thumbnails = tile.header?.tileHeaderRenderer?.thumbnail?.thumbnails ?? [];
	return {
		id: tile.contentId.replace(/^VL/, ''),
		title: titleOf(meta),
		subtitle: firstLineText(meta?.lines),
		thumbnailUrl: thumbnails[thumbnails.length - 1]?.url ?? ''
	};
}

export function collectPlaylists(root: unknown, limit: number): PlaylistSummary[] {
	const tiles: Record<string, unknown>[] = [];
	findTiles(root, tiles);

	const seen = new Set<string>();
	const results: PlaylistSummary[] = [];
	for (const tile of tiles) {
		const playlist = tileToPlaylist(tile as Tile);
		if (!playlist || seen.has(playlist.id)) continue;
		seen.add(playlist.id);
		results.push(playlist);
		if (results.length >= limit) break;
	}
	return results;
}

// The token for the next page of a TV browse response, or undefined on the
// last page. Seen in two shapes (a continuation item's command, or a
// `nextContinuationData` entry), and a page can carry several (one per shelf),
// so the last one found wins since the page-level one comes after its shelves.
export function findContinuationToken(root: unknown): string | undefined {
	let token: string | undefined;
	const visit = (node: unknown) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach(visit);
		const obj = node as Record<string, unknown>;
		const command = obj.continuationCommand as { token?: unknown } | undefined;
		if (typeof command?.token === 'string') token = command.token;
		const next = obj.nextContinuationData as { continuation?: unknown } | undefined;
		if (typeof next?.continuation === 'string') token = next.continuation;
		Object.values(obj).forEach(visit);
	};
	visit(root);
	return token;
}
