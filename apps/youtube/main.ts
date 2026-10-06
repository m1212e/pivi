// Entry point of the YouTube app image: speaks the host protocol (see
// #lib/apps/host, docs/app-protocol.schema.json) over stdin/stdout and
// wires the pieces in this folder together — login (auth.ts), browsing: this
// account's personalized home feed (tvHomeFeed.ts), signed in only, no
// anonymous fallback — and playback (stream.ts, resolved on demand by
// resolveStreamRequest — the host's streaming proxy calls this, not this app,
// so playback itself is entirely the host's concern).
//
// What this app is allowed to do isn't up to it: its manifest.json is read
// from the image by the host, and the sandbox only lets it reach the domains
// listed there once the user has switched the network permission on.
import {
	activateNotification,
	localeNotification,
	PROTOCOL_VERSION,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	resolveNextRequest,
	resolveSkipSegmentsRequest,
	resolveStreamRequest,
	shutdownNotification,
	uiEventNotification
} from '#lib/apps/host';
import type { HomeCard } from '#lib/apps/dashboard';
import type { UiNode } from '#lib/apps/ui';
import { connection } from './connection';
import { beginSignIn, isSignedIn, type DeviceCodeAuth } from './auth';
import { fetchTvHomeFeed, fetchTvHomeMore } from './tvHomeFeed';
import type { PlaylistSummary, VideoSummary } from './youtubeClient';
import {
	fetchChannelVideos,
	fetchLibraryMore,
	fetchLibrarySection,
	fetchPlaylistVideos,
	fetchVideosMore,
	isLibrarySection,
	type SectionContent,
	type VideoPage
} from './tvLibrary';
import { fetchSearch, fetchSearchMore, type SearchPage, type SearchResult } from './tvSearch';
import { fetchSuggestions } from './tvSuggestions';
import { resolveStream } from './stream';
import { fetchSkipSegments } from './sponsorBlock';
import { fetchNextVideoId } from './tvNext';
import { loadRecentSearches, recentSearches, rememberSearch } from './recentSearches';
import { innertube, loadStoredSession, setLocale } from './innertube';

const SCREEN_ID = 'browse';

// The screen mirrors the real YouTube site: a sidebar plus a grid of the
// shell's own video cards (the whole card clickable) that wraps across the
// available width, so card size and look are decided in one place, VideoCard.
const SIDEBAR_WIDTH = '14rem';
const DASHBOARD_CARDS = 15;
const LIBRARY_ICON =
	'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5z';
const ACCOUNT_ICON =
	'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z';

// Material-style 24x24 icon paths, so the sidebar needs no image assets.
const SECTIONS = [
	{ id: 'home', label: 'Home', icon: 'M4 21V9l8-6 8 6v12h-6v-7h-4v7z' },
	{
		id: 'subscriptions',
		label: 'Subscriptions',
		icon: 'M18 2H6v2h12zM20 6H4v2h16zM22 10H2v12h20zM10 20v-8l6 4z'
	}
];
const LIBRARY = [
	{
		id: 'history',
		label: 'History',
		icon: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z'
	},
	{
		id: 'playlists',
		label: 'Playlists',
		icon: 'M3 13h12v-2H3zm0-7v2h18V6zm0 12h8v-2H3zm13-3v6l5-3z'
	},
	{
		id: 'watchLater',
		label: 'Watch later',
		icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7z'
	},
	{
		id: 'liked',
		label: 'Liked videos',
		icon: 'M1 21h4V9H1zm22-11a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59A1.98 1.98 0 0 0 7 9v10a2 2 0 0 0 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73z'
	}
];

// stderr is the app's log stream; the host captures it line by line.
function log(level: 'info' | 'warn' | 'error', message: string) {
	console.error(`[${level}] ${message}`);
}

// A `session` action, not `deepLink` — the video id doubles as the session
// id since it's already exactly what resolveStream (below) needs, and it
// takes the card straight to the shared player route (see
// #lib/apps/dashboard's appActionHref) without this app needing to
// know anything about how playback actually happens.
function videoToCard(video: VideoSummary): HomeCard {
	return {
		kind: 'suggestion',
		id: video.id,
		title: video.title,
		meta: video.channelTitle,
		image: video.thumbnailUrl,
		action: { type: 'session', sessionId: video.id }
	};
}

// The device-code sign-in prompt, while one is in progress -- a code to
// read out, and the one button that actually needs the phone (the host's
// generic `openOnPhone` action, not anything auth-specific it understands).
function signInPrompt(auth: DeviceCodeAuth): UiNode {
	return {
		type: 'container',
		direction: 'column',
		center: true,
		panel: true,
		children: [
			{ type: 'icon', path: ACCOUNT_ICON, size: 'large' },
			{ type: 'text', value: 'Sign in to YouTube', variant: 'headline' },
			{ type: 'text', value: `Go to ${auth.verificationUrl} and enter`, variant: 'headline' },
			{ type: 'text', value: auth.userCode, variant: 'display' },
			{ type: 'text', value: waitingLabel(auth.status), variant: 'headline' },
			{
				type: 'button',
				label: 'Open on your phone',
				variant: 'solid',
				size: 'lg',
				action: { type: 'openOnPhone', url: auth.verificationUrl }
			}
		]
	};
}

function waitingLabel(status: string): string {
	return status === 'pending' ? 'Waiting for you to finish signing in…' : `Status: ${status}`;
}

// One grid card, the shell's own video card (the same one the home dashboard
// uses). The whole card is the "Play" action, same as videoToCard's dashboard
// suggestion, so there's no separate button competing with it for remote focus.
function videoCard(video: VideoSummary, playlistId?: string): UiNode {
	return {
		type: 'mediaCard',
		title: video.title,
		meta: video.channelTitle,
		image: video.thumbnailUrl,
		badge: video.durationText || undefined,
		action: { type: 'session', sessionId: video.id, context: playlistId }
	};
}

function navItem(section: { id: string; label: string; icon: string }): UiNode {
	return {
		type: 'button',
		label: section.label,
		variant: 'nav',
		icon: section.icon,
		selected: section.id === currentSection,
		onSelect: `nav:${section.id}`
	};
}

function sidebar(): UiNode {
	return {
		type: 'container',
		direction: 'column',
		width: SIDEBAR_WIDTH,
		sticky: true,
		children: [
			{
				type: 'textInput',
				label: 'Search',
				placeholder: 'Search',
				search: true,
				suggestions: searchSuggestions,
				onInput: 'suggest',
				onSubmit: 'search'
			},
			...SECTIONS.map(navItem),
			{ type: 'text', value: 'You', variant: 'title' },
			...LIBRARY.map(navItem)
		]
	};
}

function mainContent(results: VideoSummary[], signIn: DeviceCodeAuth | undefined): UiNode {
	// Sign-in is a manual action, not something gating activation -- the
	// screen itself still opens signed out, just with an empty grid and this
	// prompt instead of the personalized feed below. Signed in just shows the
	// grid, no separate label -- the feed being personalized is already the
	// signal that it's wired up.
	const signInNode: UiNode | undefined = isSignedIn()
		? undefined
		: signIn
			? signInPrompt(signIn)
			: {
					type: 'container',
					direction: 'column',
					center: true,
					panel: true,
					children: [
						{ type: 'icon', path: ACCOUNT_ICON, size: 'large' },
						{ type: 'text', value: 'Sign in to YouTube', variant: 'headline' },
						{
							type: 'text',
							value: 'See your recommendations and subscriptions',
							variant: 'headline'
						},
						{
							type: 'button',
							label: 'Sign in with Google',
							variant: 'solid',
							size: 'lg',
							onSelect: 'signIn'
						}
					]
				};

	// Nothing below the sign-in card until there's an account to show data for.
	if (signInNode) {
		return { type: 'container', direction: 'column', grow: true, children: [signInNode] };
	}

	return {
		type: 'container',
		direction: 'column',
		grow: true,
		children: [
			typing
				? typingView(typing)
				: openPlaylist
					? collectionView(openPlaylist)
					: currentSection === 'home'
						? videoGrid(results, homeContinuation, 'more:home')
						: currentSection === SEARCH
							? searchView()
							: sectionView()
		]
	};
}

// Skeleton cards stay at the end of a grid for as long as more can be loaded,
// so there is always something below to scroll toward. `moreEvent` is what the
// shell sends back when the first skeleton scrolls into view, see the `more:` handling in activate().
const SKELETON_COUNT = 5;

function pagedGrid(
	cards: UiNode[],
	continuation: string | undefined,
	moreEvent: string,
	title?: string
): UiNode {
	return {
		type: 'container',
		direction: 'row',
		wrap: true,
		title,
		onReachEnd: continuation ? moreEvent : undefined,
		children: [
			...cards,
			...(continuation
				? Array.from({ length: SKELETON_COUNT }, (): UiNode => ({ type: 'skeleton' }))
				: [])
		]
	};
}

function videoGrid(
	videos: VideoSummary[],
	continuation: string | undefined,
	moreEvent: string,
	title?: string,
	playlistId?: string
): UiNode {
	return pagedGrid(
		videos.map((video) => videoCard(video, playlistId)),
		continuation,
		moreEvent,
		title
	);
}

// A playlist is a card like a video, but selecting it opens its videos in this
// same screen instead of starting playback.
function playlistCard(playlist: PlaylistSummary): UiNode {
	return {
		type: 'mediaCard',
		title: playlist.title,
		meta: playlist.subtitle,
		image: playlist.thumbnailUrl,
		onSelect: `playlist:${playlist.id}`
	};
}

// Playlists are drawn as a pile of cards with their own badge, channels as a
// round profile picture, both opening in this screen. A mix has nothing to
// browse, so it plays from its first video.
function resultCard(result: SearchResult): UiNode {
	if (result.kind === 'video') return videoCard(result);
	if (result.kind === 'channel') {
		return {
			type: 'mediaCard',
			title: result.title,
			meta: result.meta,
			image: result.thumbnailUrl,
			shape: 'avatar',
			onSelect: `channel:${result.id}`
		};
	}
	return {
		type: 'mediaCard',
		title: result.title,
		meta: result.meta,
		image: result.thumbnailUrl,
		stacked: true,
		badge: result.badge,
		...(result.playVideoId
			? { action: { type: 'session', sessionId: result.playVideoId, context: result.id } }
			: { onSelect: `playlist:${result.id}` })
	};
}

function statusMessage(text: string, retrySection?: string): UiNode {
	return {
		type: 'container',
		direction: 'column',
		center: true,
		children: [
			{ type: 'icon', path: LIBRARY_ICON, size: 'large' },
			{ type: 'text', value: text, variant: 'headline' },
			...(retrySection
				? [
						{
							type: 'button',
							label: 'Try again',
							size: 'lg',
							onSelect: `nav:${retrySection}`
						} as UiNode
					]
				: [])
		]
	};
}

// While typing, the live results look exactly like a committed search. With
// nothing typed yet the recent searches are offered instead.
function typingView(state: NonNullable<typeof typing>): UiNode {
	if (!state.text) {
		const recent = recentSearches();
		if (recent.length === 0) return statusMessage('Type something to search.');
		return {
			type: 'container',
			direction: 'column',
			title: 'Recent searches',
			children: recent.map((query, i): UiNode => ({
				type: 'button',
				label: query,
				onSelect: `recent:${i}`
			}))
		};
	}
	if (!state.results) {
		return {
			type: 'container',
			direction: 'row',
			wrap: true,
			title: `Results for "${state.text}"`,
			children: Array.from({ length: SKELETON_COUNT * 2 }, (): UiNode => ({ type: 'skeleton' }))
		};
	}
	return state.results.length === 0
		? statusMessage(`No results for "${state.text}".`)
		: pagedGrid(state.results.map(resultCard), undefined, '', `Results for "${state.text}"`);
}

function searchView(): UiNode {
	if (!search) return statusMessage('Type something to search.');
	const title = `Results for "${search.query}"`;
	if (!search.page) {
		return failed.has(SEARCH) ? statusMessage(EMPTY_ERROR) : { type: 'spinner' };
	}
	return search.page.results.length === 0
		? statusMessage(`No results for "${search.query}".`)
		: pagedGrid(
				search.page.results.map(resultCard),
				search.page.continuation,
				`more:${SEARCH}`,
				title
			);
}

function sectionLabel(id: string): string {
	return [...SECTIONS, ...LIBRARY].find((section) => section.id === id)?.label ?? '';
}

function latestShelf(open: NonNullable<typeof openPlaylist>): UiNode[] {
	const latest = channelLatest.get(open.id);
	if (open.kind !== 'channel' || !latest?.length) return [];
	return [{ type: 'shelf', title: 'Latest uploads', children: latest.map((v) => videoCard(v)) }];
}

// A playlist or channel opened from the Playlists tab or from search.
function collectionView(open: NonNullable<typeof openPlaylist>): UiNode {
	const page = playlistVideos.get(open.id);
	return {
		type: 'container',
		direction: 'column',
		children: [
			{
				type: 'button',
				label: open.back === 'search' ? 'Back to results' : 'Back to playlists',
				onSelect: 'back'
			},
			...latestShelf(open),
			!page
				? failed.has(`playlist:${open.id}`)
					? statusMessage(EMPTY_ERROR)
					: { type: 'spinner' }
				: page.videos.length === 0
					? statusMessage(open.kind === 'channel' ? 'No videos here.' : 'This playlist is empty.')
					: videoGrid(
							page.videos,
							page.continuation,
							`more:playlist:${open.id}`,
							open.title,
							open.kind === 'playlist' ? open.id : undefined
						)
		]
	};
}

// One library tab (everything except Home).
function sectionView(): UiNode {
	const content = sectionCache.get(currentSection);
	if (!content) {
		return failed.has(currentSection)
			? statusMessage(EMPTY_ERROR, currentSection)
			: { type: 'spinner' };
	}

	const label = sectionLabel(currentSection);
	const moreEvent = `more:section:${currentSection}`;
	if ('playlists' in content) {
		return content.playlists.length === 0
			? statusMessage('No playlists yet.')
			: pagedGrid(content.playlists.map(playlistCard), content.continuation, moreEvent, label);
	}
	return content.videos.length === 0
		? statusMessage('Nothing here yet.')
		: videoGrid(content.videos, content.continuation, moreEvent, label);
}

function browseScreen(results: VideoSummary[], signIn: DeviceCodeAuth | undefined): UiNode {
	return {
		type: 'container',
		direction: 'row',
		alignStart: true,
		children: [sidebar(), mainContent(results, signIn)]
	};
}

function publishScreen(results: VideoSummary[]) {
	connection.sendNotification(publishScreenNotification, {
		screenId: SCREEN_ID,
		root: browseScreen(results, signInStatus)
	});
}

// Module scope (not activate()'s own local) since a sign-in re-runs refresh()
// after activate() has already run once.
let lastResults: VideoSummary[] = [];
let currentSection = 'home';
// Library tabs load on demand and are kept so switching back is instant. A
// stale copy is shown while a reload runs, rather than blanking the tab.
const sectionCache = new Map<string, SectionContent>();
const playlistVideos = new Map<string, VideoPage>();
// Newest uploads of a channel, shown above its suggested videos.
const channelLatest = new Map<string, VideoSummary[]>();
const LATEST_COUNT = 12;
// Keys that last failed to load: a section id, or `playlist:<id>`.
const failed = new Set<string>();
// Token for the next page of the home feed, undefined once it has run out.
let homeContinuation: string | undefined;
// What is currently fetching its next page (`home`, `section:<id>`,
// `playlist:<id>`), so the same grid can't request it twice at once.
const loadingMore = new Set<string>();
// `search` is the section id and also the `more:` key and `failed` entry.
const SEARCH = 'search';
let search: { query: string; page?: SearchPage } | undefined;
// A playlist or a channel opened inside the screen, from the Playlists tab or
// from search results. `back` is where its Back button returns to.
let openPlaylist:
	| { id: string; title: string; kind: 'playlist' | 'channel'; back: 'playlists' | 'search' }
	| undefined;
const EMPTY_ERROR = "Couldn't load this right now.";
// The in-progress device-code prompt, while beginSignIn() is running —
// undefined the rest of the time (signed in, or not yet started).
let signInStatus: DeviceCodeAuth | undefined;

function mergeById<T extends { id: string }>(have: T[], more: T[]): T[] {
	const seen = new Set(have.map((item) => item.id));
	return [...have, ...more.filter((item) => !seen.has(item.id))];
}

// Fetches and merges the next page for one grid, identified by the key the
// `more:` event carried.
async function fetchMore(key: string) {
	if (key === 'home') {
		if (!homeContinuation) return;
		const page = await fetchTvHomeMore(innertube, homeContinuation);
		lastResults = mergeById(lastResults, page.videos);
		homeContinuation = page.continuation;
		return;
	}

	if (key === SEARCH) {
		const have = search?.page;
		if (!search || !have?.continuation) return;
		const query = search.query;
		const next = await fetchSearchMore(innertube, have.continuation);
		// A newer search replaced this one while the page was loading.
		if (search?.query !== query || search.page !== have) return;
		search.page = {
			results: mergeById(have.results, next.results),
			continuation: next.continuation
		};
		return;
	}

	if (key.startsWith('section:')) {
		const id = key.slice('section:'.length);
		const have = sectionCache.get(id);
		if (!have?.continuation || !isLibrarySection(id)) return;
		const next = await fetchLibraryMore(innertube, id, have.continuation);
		if ('playlists' in have && 'playlists' in next) {
			sectionCache.set(id, {
				playlists: mergeById(have.playlists, next.playlists),
				continuation: next.continuation
			});
		} else if ('videos' in have && 'videos' in next) {
			sectionCache.set(id, {
				videos: mergeById(have.videos, next.videos),
				continuation: next.continuation
			});
		}
		return;
	}

	if (key.startsWith('playlist:')) {
		const id = key.slice('playlist:'.length);
		const have = playlistVideos.get(id);
		if (!have?.continuation) return;
		const next = await fetchVideosMore(innertube, have.continuation);
		playlistVideos.set(id, {
			videos: mergeById(have.videos, next.videos),
			continuation: next.continuation
		});
	}
}

async function loadMore(key: string) {
	if (loadingMore.has(key) || !isSignedIn()) return;
	loadingMore.add(key);
	try {
		await fetchMore(key);
	} catch (err) {
		// The token is kept, but the screen only asks again once the list
		// changes, so a failure just stops the scroll rather than looping.
		log('error', `TV ${key} continuation failed: ${String(err)}`);
	} finally {
		loadingMore.delete(key);
	}
	publishScreen(lastResults);
}

async function loadSection(id: string) {
	if (!isSignedIn() || !isLibrarySection(id)) return;
	failed.delete(id);
	try {
		sectionCache.set(id, await fetchLibrarySection(innertube, id));
	} catch (err) {
		// Same undocumented TV API as the home feed, so a shape change or a
		// transient failure shows a retry instead of an empty tab.
		failed.add(id);
		log('error', `TV ${id} failed: ${String(err)}`);
	}
	publishScreen(lastResults);
}

// Shown on the TV's on-screen keyboard while typing in the search field.
let searchSuggestions: string[] = [];
// Set from the first keystroke until a search runs or something is opened.
let typing: { text: string; results?: SearchResult[] } | undefined;
let typingTimer: ReturnType<typeof setTimeout> | undefined;

function updateTyping(text: string) {
	const current: NonNullable<typeof typing> = { text };
	typing = current;
	clearTimeout(typingTimer);
	if (text.length >= 2 && isSignedIn()) {
		// Waits for a pause so each keystroke doesn't start its own search.
		typingTimer = setTimeout(async () => {
			try {
				const page = await fetchSearch(innertube, text);
				if (typing !== current) return;
				current.results = page.results;
			} catch (err) {
				log('error', `live results for "${text}" failed: ${String(err)}`);
				if (typing !== current) return;
				current.results = [];
			}
			publishScreen(lastResults);
		}, 400);
	}
	publishScreen(lastResults);
}

function leaveTyping() {
	typing = undefined;
	clearTimeout(typingTimer);
}
let suggestionQuery = '';

async function suggest(text: string) {
	suggestionQuery = text;
	let next: string[] = [];
	if (text) {
		try {
			next = await fetchSuggestions(innertube, text);
		} catch (err) {
			log('error', `search suggestions for "${text}" failed: ${String(err)}`);
		}
	}
	// A slower answer for text that has since changed would flash old entries.
	if (suggestionQuery !== text) return;
	searchSuggestions = next;
	publishScreen(lastResults);
}

async function runSearch(query: string) {
	if (!isSignedIn()) return;
	searchSuggestions = [];
	suggestionQuery = '';
	leaveTyping();
	void rememberSearch(query);
	failed.delete(SEARCH);
	currentSection = SEARCH;
	openPlaylist = undefined;
	const current: NonNullable<typeof search> = { query };
	search = current;
	publishScreen(lastResults);
	try {
		current.page = await fetchSearch(innertube, query);
	} catch (err) {
		if (search === current) failed.add(SEARCH);
		log('error', `TV search "${query}" failed: ${String(err)}`);
	}
	if (search === current) publishScreen(lastResults);
}

// What a playlist or channel was called on the card that opened it.
function knownTitle(id: string): string | undefined {
	const fromSearch = search?.page?.results.find((r) => r.id === id)?.title;
	if (fromSearch) return fromSearch;
	const known = sectionCache.get('playlists');
	return known && 'playlists' in known
		? known.playlists.find((p) => p.id === id)?.title
		: undefined;
}

async function loadCollection(kind: 'playlist' | 'channel', id: string) {
	failed.delete(`playlist:${id}`);
	try {
		if (kind === 'channel') {
			// A channel's uploads playlist id is its id with UC swapped for UU.
			const uploads = id.startsWith('UC') ? `UU${id.slice(2)}` : undefined;
			const [page, latest] = await Promise.all([
				fetchChannelVideos(innertube, id),
				uploads
					? fetchPlaylistVideos(innertube, uploads).catch(() => undefined)
					: Promise.resolve(undefined)
			]);
			if (latest) channelLatest.set(id, latest.videos.slice(0, LATEST_COUNT));
			playlistVideos.set(id, page);
		} else {
			playlistVideos.set(id, await fetchPlaylistVideos(innertube, id));
		}
	} catch (err) {
		failed.add(`playlist:${id}`);
		log('error', `TV playlist ${id} failed: ${String(err)}`);
	}
	publishScreen(lastResults);
}

async function refresh() {
	// A new session (sign-in) or a manual refresh must not keep another
	// account's tabs around.
	sectionCache.clear();
	playlistVideos.clear();
	channelLatest.clear();
	failed.clear();

	if (isSignedIn()) {
		try {
			const page = await fetchTvHomeFeed(innertube);
			lastResults = page.videos;
			homeContinuation = page.continuation;
			if (!homeContinuation) {
				log('warn', `home feed has no continuation token (${page.videos.length} videos)`);
			}
		} catch (err) {
			// TV's home feed is undocumented internal API — a shape change
			// or a transient failure shouldn't take the whole dashboard
			// down with it, so this just leaves lastResults as-is.
			const info = (err as { info?: unknown } | undefined)?.info;
			log('error', `TV home feed failed: ${String(err)} info=${JSON.stringify(info)}`);
		}
	} else {
		// No signed-out fallback content on purpose: there's nothing worth showing
		// without a signed-in account, and browseScreen already surfaces the
		// "Sign in with Google" button.
		lastResults = [];
		homeContinuation = undefined;
	}

	connection.sendNotification(publishDashboardNotification, {
		// The dashboard shelf only wants the top of the feed, however far the
		// screen's infinite scroll has loaded.
		cards: lastResults.slice(0, DASHBOARD_CARDS).map(videoToCard)
	});
	publishScreen(lastResults);
	if (currentSection !== 'home') void loadSection(currentSection);
}

function main() {
	connection.sendNotification(readyNotification, { protocol: PROTOCOL_VERSION });

	// Registered right after ready is sent, before anything is awaited, so an
	// 'activate' that arrives straight away is never missed.
	connection.onNotification(activateNotification, ({ locale }) => {
		setLocale(locale);
		activate().catch((err: unknown) => {
			log('error', err instanceof Error ? err.message : String(err));
		});
	});

	// The language can become known after activation, once a page was opened on
	// the TV. What was loaded so far is in the old one, so it is fetched again.
	connection.onNotification(localeNotification, ({ locale }) => {
		setLocale(locale);
		if (activated) void refresh();
	});

	connection.onNotification(shutdownNotification, () => process.exit(0));

	// The host's streaming proxy calls this on demand (see
	// src/routes/api/stream/[appId]/[sessionId]) — sessionId is just the
	// video id for this app, an opaque string as far as the host's
	// concerned, same as a deepLink target already is.
	connection.onRequest(resolveStreamRequest, ({ sessionId, maxHeight }) =>
		resolveStream(sessionId, maxHeight)
	);

	// The context is the playlist (or mix) id the video was started from.
	connection.onRequest(resolveNextRequest, async ({ sessionId, context }) => {
		if (!context) return {};
		try {
			return { sessionId: await fetchNextVideoId(innertube, sessionId, context) };
		} catch (err) {
			log('error', `next video failed: ${err instanceof Error ? err.message : String(err)}`);
			return {};
		}
	});

	// sessionId doubles as the video id here too (see resolveStreamRequest's
	// own comment) -- SponsorBlock keys its own data off the same id.
	connection.onRequest(resolveSkipSegmentsRequest, async ({ sessionId }) => {
		try {
			return { segments: await fetchSkipSegments(sessionId) };
		} catch (err) {
			log('error', err instanceof Error ? err.message : String(err));
			return { segments: [] };
		}
	});
}

let activated = false;

async function activate() {
	// Needed before isSignedIn() (refresh()/browseScreen(), below) can be
	// trusted — see loadStoredSession's own comment.
	await loadStoredSession();
	await loadRecentSearches();
	activated = true;
	await refresh();

	connection.onNotification(uiEventNotification, (event) => {
		if (event.screenId !== SCREEN_ID) return;

		if (event.eventId === 'suggest') {
			const text = typeof event.value === 'string' ? event.value.trim() : '';
			updateTyping(text);
			void suggest(text);
			return;
		}

		const recentMatch = /^recent:(\d+)$/.exec(event.eventId);
		if (recentMatch) {
			const query = recentSearches()[Number(recentMatch[1])];
			if (query) void runSearch(query);
			return;
		}

		if (event.eventId === 'search') {
			const query = typeof event.value === 'string' ? event.value.trim() : '';
			if (query) void runSearch(query);
			return;
		}

		if (event.eventId.startsWith('nav:')) {
			currentSection = event.eventId.slice('nav:'.length);
			leaveTyping();
			openPlaylist = undefined;
			publishScreen(lastResults);
			void loadSection(currentSection);
			return;
		}

		const opened = /^(playlist|channel):(.+)$/.exec(event.eventId);
		if (opened) {
			const kind = opened[1] as 'playlist' | 'channel';
			const id = opened[2];
			leaveTyping();
			openPlaylist = {
				id,
				kind,
				title: knownTitle(id) ?? (kind === 'channel' ? 'Channel' : 'Playlist'),
				back: currentSection === SEARCH ? 'search' : 'playlists'
			};
			publishScreen(lastResults);
			void loadCollection(kind, id);
			return;
		}

		if (event.eventId.startsWith('more:')) {
			void loadMore(event.eventId.slice('more:'.length));
			return;
		}

		if (event.eventId === 'back') {
			openPlaylist = undefined;
			publishScreen(lastResults);
			return;
		}

		if (event.eventId === 'signIn') {
			beginSignIn((status) => {
				signInStatus = status;
				publishScreen(lastResults);
			})
				.then(() => {
					// A real refresh now, not just re-publishing the screen — signing
					// in switches the feed itself over to this account's real
					// personalized one (tvHomeFeed.ts), not just the "Signed in" label.
					signInStatus = undefined;
					return refresh();
				})
				.catch((err: unknown) => {
					log('error', err instanceof Error ? err.message : String(err));
				});
		}
	});
}

main();
