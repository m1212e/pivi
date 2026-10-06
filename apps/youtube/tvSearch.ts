// Search through the same TV client as the home feed, but its response uses
// `lockupViewModel` entries instead of the `tileRenderer` ones tvTiles.ts reads.
// Besides videos it holds playlists, series and channels, which the app shows
// as cards of their own. Shorts are left out.
import type { Innertube } from 'youtubei.js';
import { findContinuationToken, walkObjects } from './tvTiles';
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

function findLockups(node: unknown, out: Lockup[]) {
	walkObjects(node, (obj) => {
		if (obj.lockupViewModel) out.push(obj.lockupViewModel as Lockup);
	});
}

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

type BadgeViewModels = { thumbnailBadgeViewModel?: { text?: string } }[];

function firstBadgeText(badges: BadgeViewModels): string | undefined {
	return badges.map((b) => b.thumbnailBadgeViewModel?.text).find(Boolean);
}

function titleOf(lockup: Lockup, fallback: string): string {
	return lockup.metadata?.lockupMetadataViewModel?.title?.content ?? fallback;
}

function durationOf(lockup: Lockup): string {
	const overlays = lockup.contentImage?.thumbnailViewModel?.overlays ?? [];
	return (
		firstBadgeText(overlays.flatMap((o) => o.thumbnailBottomOverlayViewModel?.badges ?? [])) ?? ''
	);
}

function toVideo(lockup: Lockup, id: string): SearchResult {
	return {
		kind: 'video',
		id,
		title: titleOf(lockup, 'Untitled'),
		channelTitle: metaParts(lockup)[0] ?? '',
		durationText: durationOf(lockup),
		// Same 16:9 source as the other tabs, see tvTiles.ts.
		thumbnailUrl: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
	};
}

function playlistThumbnail(lockup: Lockup) {
	return lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel;
}

function thumbnailBadgeText(lockup: Lockup): string | undefined {
	const overlays = playlistThumbnail(lockup)?.overlays ?? [];
	return firstBadgeText(
		overlays.flatMap((o) => o.thumbnailOverlayBadgeViewModel?.thumbnailBadges ?? [])
	);
}

function playlistBadge(lockup: Lockup, isMix: boolean): string {
	return thumbnailBadgeText(lockup) ?? (isMix ? 'Mix' : 'Playlist');
}

function toPlaylist(lockup: Lockup, id: string): SearchResult {
	const isMix = id.startsWith('RD');
	return {
		kind: 'playlist',
		id,
		title: titleOf(lockup, 'Untitled'),
		meta: metaParts(lockup).join(' • '),
		thumbnailUrl: absolute(playlistThumbnail(lockup)?.image?.sources?.at(-1)?.url),
		badge: playlistBadge(lockup, isMix),
		playVideoId: isMix
			? lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId
			: undefined
	};
}

function toChannel(lockup: Lockup, id: string): SearchResult {
	const parts = metaParts(lockup);
	return {
		kind: 'channel',
		id,
		title: titleOf(lockup, 'Channel'),
		// The handle comes first, the subscriber count says more.
		meta: parts[1] ?? parts[0] ?? '',
		thumbnailUrl: absolute(lockup.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url)
	};
}

type Converter = (lockup: Lockup, id: string) => SearchResult;

// Long music uploads (mixes, albums) come back as MUSIC rather than VIDEO, and
// they are most of what a music query returns. Both play as a normal video.
// A series is a playlist with a nicer page.
const CONVERTERS = new Map<string, Converter>([
	['LOCKUP_CONTENT_TYPE_VIDEO', toVideo],
	['LOCKUP_CONTENT_TYPE_MUSIC', toVideo],
	['LOCKUP_CONTENT_TYPE_PLAYLIST', toPlaylist],
	['LOCKUP_CONTENT_TYPE_SHOW', toPlaylist],
	['LOCKUP_CONTENT_TYPE_CHANNEL', toChannel]
]);

function toResult(lockup: Lockup): SearchResult | null {
	const { contentId, contentType } = lockup;
	const convert = contentType ? CONVERTERS.get(contentType) : undefined;
	return contentId && convert ? convert(lockup, contentId) : null;
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
