// The signed-in account's own library, via the same TV client and raw-tile
// walking as the home feed (tvHomeFeed.ts): subscriptions, history, playlists,
// watch later and liked videos are all just different browse ids returning the
// same tile shape.
import { YTNodes } from 'youtubei.js';
import type { Innertube } from 'youtubei.js';
import type { PlaylistSummary, VideoSummary } from './youtubeClient';
import { collectPlaylists, collectTiles, findContinuationToken } from './tvTiles';

// A page is everything the response holds: cutting it off would skip the tiles
// the continuation token already points past.
const PAGE_LIMIT = 1000;

export type LibrarySection = 'subscriptions' | 'history' | 'playlists' | 'watchLater' | 'liked';

type Kind = 'videos' | 'playlists';
type Source = { browseId: string; kind: Kind };

// Watch later and liked videos are system playlists, whose browse ids are `VL`
// plus a fixed playlist id (WL, LL).
const SOURCES: Record<LibrarySection, Source> = {
	subscriptions: { browseId: 'FEsubscriptions', kind: 'videos' },
	history: { browseId: 'FEhistory', kind: 'videos' },
	playlists: { browseId: 'FEplaylist_aggregation', kind: 'playlists' },
	watchLater: { browseId: 'VLWL', kind: 'videos' },
	liked: { browseId: 'VLLL', kind: 'videos' }
};

// `continuation` is the token for the next page, undefined on the last one.
export type VideoPage = { videos: VideoSummary[]; continuation?: string };
export type PlaylistPage = { playlists: PlaylistSummary[]; continuation?: string };
export type SectionContent = VideoPage | PlaylistPage;

export function isLibrarySection(id: string): id is LibrarySection {
	return id in SOURCES;
}

type Raw = { data: unknown };

async function browseTv(innertube: Innertube, browseId: string): Promise<unknown> {
	const endpoint = new YTNodes.NavigationEndpoint({ browseEndpoint: { browseId } });
	return ((await endpoint.call(innertube.actions, { client: 'TV' })) as Raw).data;
}

// The next page of whatever a continuation token came from.
export async function browseTvMore(innertube: Innertube, continuation: string): Promise<unknown> {
	return ((await innertube.actions.execute('/browse', { continuation, client: 'TV' })) as Raw).data;
}

function videoPage(data: unknown): VideoPage {
	return { videos: collectTiles(data, PAGE_LIMIT), continuation: findContinuationToken(data) };
}

function playlistPage(data: unknown): PlaylistPage {
	return {
		playlists: collectPlaylists(data, PAGE_LIMIT),
		continuation: findContinuationToken(data)
	};
}

function pageFor(kind: Kind, data: unknown): SectionContent {
	return kind === 'playlists' ? playlistPage(data) : videoPage(data);
}

export async function fetchLibrarySection(
	innertube: Innertube,
	section: LibrarySection
): Promise<SectionContent> {
	const { browseId, kind } = SOURCES[section];
	return pageFor(kind, await browseTv(innertube, browseId));
}

export async function fetchLibraryMore(
	innertube: Innertube,
	section: LibrarySection,
	continuation: string
): Promise<SectionContent> {
	return pageFor(SOURCES[section].kind, await browseTvMore(innertube, continuation));
}

// The videos inside one playlist, from the Playlists tab.
export async function fetchPlaylistVideos(
	innertube: Innertube,
	playlistId: string
): Promise<VideoPage> {
	return videoPage(await browseTv(innertube, `VL${playlistId}`));
}

// A channel's page, which is a browse like any other, just by channel id.
export async function fetchChannelVideos(
	innertube: Innertube,
	channelId: string
): Promise<VideoPage> {
	return videoPage(await browseTv(innertube, channelId));
}

export async function fetchVideosMore(
	innertube: Innertube,
	continuation: string
): Promise<VideoPage> {
	return videoPage(await browseTvMore(innertube, continuation));
}
