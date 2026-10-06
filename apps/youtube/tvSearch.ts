// Search through the same TV client as the home feed, but its response uses
// `lockupViewModel` entries instead of the `tileRenderer` ones tvTiles.ts reads.
// Besides videos it holds playlists, series and channels, which the app shows
// as cards of their own. Shorts are left out.
import type { Innertube } from 'youtubei.js';
import { findContinuationToken } from './tvTiles';
import type { VideoSummary } from './youtubeClient';

type ImageSources = { image?: { sources?: { url?: string }[] } };

type Lockup = {
	contentId?: string;
	contentType?: string;
	contentImage?: {
		thumbnailViewModel?: ImageSources & {
			overlays?: {
				thumbnailBottomOverlayViewModel?: {
					badges?: { thumbnailBadgeViewModel?: { text?: string } }[];
				};
			}[];
		};
		collectionThumbnailViewModel?: {
			primaryThumbnail?: {
				thumbnailViewModel?: ImageSources & {
					overlays?: {
						thumbnailOverlayBadgeViewModel?: {
							thumbnailBadges?: { thumbnailBadgeViewModel?: { text?: string } }[];
						};
					}[];
				};
			};
		};
	};
	metadata?: {
		lockupMetadataViewModel?: {
			title?: { content?: string };
			metadata?: {
				contentMetadataViewModel?: {
					metadataRows?: { metadataParts?: { text?: { content?: string } }[] }[];
				};
			};
		};
	};
	rendererContext?: {
		commandContext?: {
			onTap?: { innertubeCommand?: { watchEndpoint?: { videoId?: string } } };
		};
	};
};

export type SearchResult =
	| ({ kind: 'video' } & VideoSummary)
	| {
			kind: 'playlist';
			id: string;
			title: string;
			meta: string;
			thumbnailUrl: string;
			// What the thumbnail says, e.g. "Mix" or a video count.
			badge: string;
			// A mix is generated per video and has no page to browse, so it
			// plays from this video instead.
			playVideoId?: string;
	  }
	| { kind: 'channel'; id: string; title: string; meta: string; thumbnailUrl: string };

// `continuation` is the token for the next page, undefined on the last one.
export type SearchPage = { results: SearchResult[]; continuation?: string };

type Raw = { data: unknown };

// fallow-ignore-next-line complexity
function findLockups(node: unknown, out: Lockup[]) {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		node.forEach((item) => findLockups(item, out));
		return;
	}
	const obj = node as Record<string, unknown>;
	if (obj.lockupViewModel) out.push(obj.lockupViewModel as Lockup);
	Object.values(obj).forEach((value) => findLockups(value, out));
}

// Long music uploads (mixes, albums) come back as MUSIC rather than VIDEO, and
// they are most of what a music query returns. Both play as a normal video.
const VIDEO_TYPES = new Set(['LOCKUP_CONTENT_TYPE_VIDEO', 'LOCKUP_CONTENT_TYPE_MUSIC']);
// A series is a playlist with a nicer page.
const PLAYLIST_TYPES = new Set(['LOCKUP_CONTENT_TYPE_PLAYLIST', 'LOCKUP_CONTENT_TYPE_SHOW']);

function metaParts(lockup: Lockup): string[] {
	const rows =
		lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
	return (rows ?? []).flatMap((row) =>
		(row.metadataParts ?? []).flatMap((part) => (part.text?.content ? [part.text.content] : []))
	);
}

// Some sources come without a scheme.
function absolute(url: string | undefined): string {
	if (!url) return '';
	return url.startsWith('//') ? `https:${url}` : url;
}

// fallow-ignore-next-line complexity
function toVideo(lockup: Lockup): SearchResult | null {
	if (!lockup.contentId) return null;
	const meta = lockup.metadata?.lockupMetadataViewModel;
	const overlays = lockup.contentImage?.thumbnailViewModel?.overlays ?? [];
	const duration = overlays
		.flatMap((o) => o.thumbnailBottomOverlayViewModel?.badges ?? [])
		.map((b) => b.thumbnailBadgeViewModel?.text)
		.find(Boolean);
	return {
		kind: 'video',
		id: lockup.contentId,
		title: meta?.title?.content ?? 'Untitled',
		channelTitle: metaParts(lockup)[0] ?? '',
		durationText: duration ?? '',
		// Same 16:9 source as the other tabs, see tvTiles.ts.
		thumbnailUrl: `https://i.ytimg.com/vi/${lockup.contentId}/maxresdefault.jpg`
	};
}

// fallow-ignore-next-line complexity
function toPlaylist(lockup: Lockup): SearchResult | null {
	if (!lockup.contentId) return null;
	const thumbnail =
		lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel;
	const badge = (thumbnail?.overlays ?? [])
		.flatMap((o) => o.thumbnailOverlayBadgeViewModel?.thumbnailBadges ?? [])
		.map((b) => b.thumbnailBadgeViewModel?.text)
		.find(Boolean);
	const isMix = lockup.contentId.startsWith('RD');
	return {
		kind: 'playlist',
		id: lockup.contentId,
		title: lockup.metadata?.lockupMetadataViewModel?.title?.content ?? 'Untitled',
		meta: metaParts(lockup).join(' • '),
		thumbnailUrl: absolute(thumbnail?.image?.sources?.at(-1)?.url),
		badge: badge ?? (isMix ? 'Mix' : 'Playlist'),
		playVideoId: isMix
			? lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId
			: undefined
	};
}

// fallow-ignore-next-line complexity
function toChannel(lockup: Lockup): SearchResult | null {
	if (!lockup.contentId) return null;
	const parts = metaParts(lockup);
	return {
		kind: 'channel',
		id: lockup.contentId,
		title: lockup.metadata?.lockupMetadataViewModel?.title?.content ?? 'Channel',
		// The handle comes first, the subscriber count says more.
		meta: parts[1] ?? parts[0] ?? '',
		thumbnailUrl: absolute(lockup.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url)
	};
}

// fallow-ignore-next-line complexity
function toResult(lockup: Lockup): SearchResult | null {
	const type = lockup.contentType ?? '';
	if (VIDEO_TYPES.has(type)) return toVideo(lockup);
	if (PLAYLIST_TYPES.has(type)) return toPlaylist(lockup);
	if (type === 'LOCKUP_CONTENT_TYPE_CHANNEL') return toChannel(lockup);
	return null;
}

function toPage(data: unknown): SearchPage {
	const lockups: Lockup[] = [];
	findLockups(data, lockups);
	const seen = new Set<string>();
	const results: SearchResult[] = [];
	for (const lockup of lockups) {
		const result = toResult(lockup);
		if (!result || seen.has(result.id)) continue;
		seen.add(result.id);
		results.push(result);
	}
	return { results, continuation: findContinuationToken(data) };
}

export async function fetchSearch(innertube: Innertube, query: string): Promise<SearchPage> {
	const raw = (await innertube.actions.execute('/search', { query, client: 'TV' })) as Raw;
	return toPage(raw.data);
}

export async function fetchSearchMore(
	innertube: Innertube,
	continuation: string
): Promise<SearchPage> {
	const raw = (await innertube.actions.execute('/search', { continuation, client: 'TV' })) as Raw;
	return toPage(raw.data);
}
