// Entry point of the Twitch app image: speaks the host protocol (see
// sdk/protocol.ts) over stdin/stdout. Browsing comes from Twitch's GQL API
// (gql.ts), as the signed-in account when there is one (auth.ts), playback
// from stream.ts, which hands the host a live HLS playlist, and chat from
// chat.ts. Playing it is the host's job (the stream-hls proxy and the shared
// player), the session id is just the channel login.
//
// Everything personal (who is signed in, whom they follow) is asked of Twitch
// when shown, never kept here: the token is the only thing stored.
import type { HomeCard } from '@pivi/sdk/dashboard';
import type { HostIcon } from '@pivi/sdk/icons';
import type { UiNode } from '@pivi/sdk/ui';
import { defineApp } from '@pivi/sdk/app';
import { beginSignIn, isSignedIn, loadSession, signOut, type DeviceCodeAuth } from './auth';
import { createChat } from './chat';
import {
	categoryStreams,
	channelProfile,
	channelVideos,
	currentAccount,
	followedLive,
	search,
	searchSuggestions,
	topCategories,
	topStreams,
	viewerCount,
	type Account,
	type Category,
	type Channel,
	type ChannelVideos,
	type LiveStream,
	type Profile,
	type SearchResults,
	type Video
} from './gql';
import { resolveStream, vodSession } from './stream';

const SCREEN_ID = 'browse';
const SIDEBAR_WIDTH = '14rem';
const DASHBOARD_CARDS = 15;
const EMPTY_ERROR = "Couldn't load this right now.";

// Host icons (@pivi/sdk/icons), drawn by the shell in its own style.
const SECTIONS: { id: string; label: string; icon: HostIcon }[] = [
	{ id: 'following', label: 'Following', icon: 'heart' },
	{ id: 'browse', label: 'Live now', icon: 'radio' },
	{ id: 'categories', label: 'Categories', icon: 'grid' }
];
const ACCOUNT_ICON: HostIcon = 'user';
const LIVE_ICON: HostIcon = 'tv';

function log(level: 'info' | 'warn' | 'error', message: string) {
	console.error(`[${level}] ${message}`);
}

function viewerLabel(viewers: number): string {
	const count = new Intl.NumberFormat(app.locale, {
		notation: 'compact',
		maximumFractionDigits: 1
	});
	return `${count.format(viewers)} viewers`;
}

function followersLabel(followers: number): string {
	const count = new Intl.NumberFormat(app.locale, {
		notation: 'compact',
		maximumFractionDigits: 1
	});
	return `${count.format(followers)} followers`;
}

// --- state ---------------------------------------------------------------

let section = 'browse';
let browse: LiveStream[] | undefined;
// The signed-in account and its followed live channels, both from Twitch.
let account: Account | undefined;
let following: LiveStream[] | undefined;
// The device code prompt while a sign-in waits for the phone, or ended badly.
let signInStatus: DeviceCodeAuth | undefined;
let categories: Category[] | undefined;
// A category opened from the Categories tab or from search, `back` is where
// its Back button returns to.
let openCategory: { id: string; name: string; back: 'categories' | 'search' } | undefined;
// Only the last few, so browsing through categories doesn't keep every list
// ever opened. Live lists go stale fast anyway, opening one reloads it.
const categoryStreamsById = new Map<string, LiveStream[]>();
const KEEP_CATEGORIES = 3;
let searchState: { query: string; results?: SearchResults } | undefined;
// Shown on the on-screen keyboard while typing in the search field.
let suggestions: string[] = [];
// A channel's page, opened from search. Only the open one is kept, `null`
// once Twitch says there's no such channel.
let openProfile: { login: string; profile?: Profile | null; videos?: ChannelVideos } | undefined;
// Keys that last failed to load: a section id, `search` or `category:<id>`.
const failed = new Set<string>();

// --- rendering -----------------------------------------------------------

function streamCard(stream: LiveStream): UiNode {
	return {
		type: 'mediaCard',
		title: stream.title || stream.displayName,
		meta: stream.game ? `${stream.displayName} · ${stream.game}` : stream.displayName,
		image: stream.preview,
		badge: viewerLabel(stream.viewers),
		action: { type: 'session', sessionId: stream.login }
	};
}

function categoryCard(category: Category): UiNode {
	return {
		type: 'mediaCard',
		title: category.name,
		meta: viewerLabel(category.viewers),
		image: category.boxArt,
		shape: 'poster',
		onSelect: `category:${category.id}`
	};
}

// Every channel a search finds, live or not, as its profile picture. It opens
// the channel's page, the live ones are also listed as streams to play.
function channelCard(channel: Channel): UiNode {
	return {
		type: 'mediaCard',
		title: channel.displayName,
		meta: channel.stream ? `Live · ${viewerLabel(channel.stream.viewers)}` : 'Offline',
		image: channel.avatar,
		shape: 'avatar',
		onSelect: `profile:${channel.login}`
	};
}

// Lists come whole, Twitch doesn't let anonymous requests page (see gql.ts).
function grid(cards: UiNode[], title?: string): UiNode {
	return { type: 'container', direction: 'row', wrap: true, title, children: cards };
}

function statusMessage(text: string, retry?: string): UiNode {
	return {
		type: 'container',
		direction: 'column',
		center: true,
		children: [
			{ type: 'icon', path: LIVE_ICON, size: 'large' },
			{ type: 'text', value: text, variant: 'headline' },
			...(retry
				? [{ type: 'button', label: 'Try again', size: 'lg', onSelect: retry } as UiNode]
				: [])
		]
	};
}

function pending(key: string, retry: string): UiNode {
	return failed.has(key) ? statusMessage(EMPTY_ERROR, retry) : { type: 'spinner' };
}

function browseView(): UiNode {
	if (!browse) return pending('browse', 'nav:browse');
	if (browse.length === 0) return statusMessage('Nobody is live right now.');
	return grid(browse.map(streamCard), 'Live now');
}

function signInPrompt(auth: DeviceCodeAuth): UiNode {
	const waiting = auth.status === 'pending';
	return {
		type: 'container',
		direction: 'column',
		center: true,
		panel: true,
		children: [
			{ type: 'icon', path: ACCOUNT_ICON, size: 'large' },
			{ type: 'text', value: 'Sign in to Twitch', variant: 'headline' },
			{ type: 'text', value: `Go to ${auth.verificationUrl} and enter`, variant: 'headline' },
			{ type: 'text', value: auth.userCode, variant: 'display' },
			{
				type: 'text',
				value: waiting
					? 'Waiting for you to finish signing in…'
					: auth.status === 'expired'
						? 'The code expired.'
						: 'Signing in failed.',
				variant: 'headline'
			},
			waiting
				? {
						type: 'button',
						label: 'Open on your phone',
						variant: 'solid',
						size: 'lg',
						action: { type: 'openOnPhone', url: auth.phoneUrl }
					}
				: {
						type: 'button',
						label: 'Get a new code',
						variant: 'solid',
						size: 'lg',
						onSelect: 'signIn'
					}
		]
	};
}

function signedOutCard(): UiNode {
	return {
		type: 'container',
		direction: 'column',
		center: true,
		panel: true,
		children: [
			{ type: 'icon', path: ACCOUNT_ICON, size: 'large' },
			{ type: 'text', value: 'Sign in to Twitch', variant: 'headline' },
			{ type: 'text', value: 'See who you follow is live', variant: 'headline' },
			{ type: 'button', label: 'Sign in', variant: 'solid', size: 'lg', onSelect: 'signIn' }
		]
	};
}

function followingView(): UiNode {
	if (signInStatus) return signInPrompt(signInStatus);
	if (!isSignedIn()) return signedOutCard();
	if (!following) return pending('following', 'nav:following');
	if (following.length === 0) return statusMessage('Nobody you follow is live right now.');
	return grid(following.map(streamCard), 'Following');
}

function categoriesView(): UiNode {
	if (!categories) return pending('categories', 'nav:categories');
	return grid(categories.map(categoryCard), 'Categories');
}

const BACK_LABELS = { categories: 'Back to categories', search: 'Back to results' };

// In a row of its own, so the column it sits in doesn't stretch it into a
// full-width bar: a compact glass pill with an arrow, at the top left.
function backButton(label: string): UiNode {
	return {
		type: 'container',
		direction: 'row',
		children: [
			{ type: 'button', label, icon: 'arrow-left', variant: 'soft', size: 'md', onSelect: 'back' }
		]
	};
}

function categoryView(open: NonNullable<typeof openCategory>): UiNode {
	const streams = categoryStreamsById.get(open.id);
	let body: UiNode;
	if (!streams) body = pending(`category:${open.id}`, `category:${open.id}`);
	else if (streams.length === 0) body = statusMessage(`Nobody is live in ${open.name}.`);
	else body = grid(streams.map(streamCard), open.name);
	return {
		type: 'container',
		direction: 'column',
		children: [backButton(BACK_LABELS[open.back]), body]
	};
}

function searchView(): UiNode {
	if (!searchState) return statusMessage('Type something to search.');
	const { query, results } = searchState;
	if (!results) return pending('search', 'retrySearch');
	const { channels, categories: found } = results;
	if (channels.length === 0 && found.length === 0)
		return statusMessage(`No results for "${query}".`);
	const live = channels.flatMap((channel) => (channel.stream ? [channel.stream] : []));
	const children: UiNode[] = [];
	if (channels.length) {
		children.push({ type: 'shelf', title: 'Channels', children: channels.map(channelCard) });
	}
	if (found.length) {
		children.push({ type: 'shelf', title: 'Categories', children: found.map(categoryCard) });
	}
	if (live.length) children.push(grid(live.map(streamCard), `Live for "${query}"`));
	return { type: 'container', direction: 'column', children };
}

function formatDate(iso: string | undefined): string | undefined {
	if (!iso) return undefined;
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? undefined
		: new Intl.DateTimeFormat(app.locale, { dateStyle: 'medium' }).format(date);
}

// 2:45:02, or 12:07 under an hour, as on the website's thumbnails.
function durationLabel(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const pad = (n: number) => String(n).padStart(2, '0');
	return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function videoCard(video: Video): UiNode {
	const meta = [formatDate(video.createdAt), video.game].filter(Boolean).join(' · ');
	return {
		type: 'mediaCard',
		title: video.title || 'Untitled',
		meta,
		image: video.preview,
		badge: durationLabel(video.lengthSeconds),
		action: { type: 'session', sessionId: vodSession(video.id) }
	};
}

// What the channel put out besides the live stream, one row per kind, left
// out when empty.
function videoShelves(videos: ChannelVideos | undefined): UiNode[] {
	if (!videos) return [];
	const kinds: [string, Video[]][] = [
		['Past broadcasts', videos.broadcasts],
		['Highlights', videos.highlights],
		['Uploads', videos.uploads]
	];
	return kinds.flatMap(([title, list]): UiNode[] =>
		list.length ? [{ type: 'shelf', title, children: list.map(videoCard) }] : []
	);
}

function lastBroadcastLabel(last: NonNullable<Profile['lastBroadcast']>): string {
	const parts = ['Last streamed'];
	if (last.game) parts.push(last.game);
	const date = formatDate(last.startedAt);
	if (date) parts.push(date);
	return parts.length > 1 ? `${parts[0]} ${parts.slice(1).join(' · ')}` : parts[0];
}

// Picture, name and bio, then the stream to play when live, or what it
// streamed last when not, then its videos.
function profileBody(profile: Profile, videos: ChannelVideos | undefined): UiNode[] {
	const about: UiNode[] = [{ type: 'text', value: profile.displayName, variant: 'display' }];
	if (profile.followers !== undefined) {
		about.push({ type: 'text', value: followersLabel(profile.followers), variant: 'subtitle' });
	}
	if (profile.description) {
		about.push({ type: 'text', value: profile.description, variant: 'body', lines: 4 });
	}
	const header: UiNode = {
		type: 'container',
		direction: 'row',
		alignStart: true,
		children: [
			...(profile.avatar
				? [{ type: 'image', src: profile.avatar, aspect: 'square', width: '10rem' } as UiNode]
				: []),
			{ type: 'container', direction: 'column', grow: true, children: about }
		]
	};
	if (profile.stream) {
		const stream = profile.stream;
		return [
			header,
			{
				type: 'hero',
				title: stream.title || stream.displayName,
				description: stream.game
					? `${stream.game} · ${viewerLabel(stream.viewers)}`
					: viewerLabel(stream.viewers),
				image: stream.preview || undefined,
				badge: 'LIVE',
				action: { type: 'session', sessionId: stream.login }
			},
			...videoShelves(videos)
		];
	}
	const offline: UiNode[] = [{ type: 'text', value: 'Offline', variant: 'headline' }];
	if (profile.lastBroadcast) {
		offline.push({
			type: 'text',
			value: lastBroadcastLabel(profile.lastBroadcast),
			variant: 'body'
		});
		if (profile.lastBroadcast.title) {
			offline.push({ type: 'text', value: profile.lastBroadcast.title, variant: 'body', lines: 2 });
		}
	}
	return [
		header,
		{ type: 'container', direction: 'column', panel: true, children: offline },
		...videoShelves(videos)
	];
}

function profileView(open: NonNullable<typeof openProfile>): UiNode {
	let body: UiNode[];
	if (open.profile === undefined)
		body = [pending(`profile:${open.login}`, `profile:${open.login}`)];
	else if (open.profile === null) body = [statusMessage("This channel doesn't exist anymore.")];
	else body = profileBody(open.profile, open.videos);
	return {
		type: 'container',
		direction: 'column',
		children: [backButton(BACK_LABELS.search), ...body]
	};
}

function mainView(): UiNode {
	if (openProfile) return profileView(openProfile);
	if (openCategory) return categoryView(openCategory);
	if (section === 'search') return searchView();
	if (section === 'following') return followingView();
	return section === 'categories' ? categoriesView() : browseView();
}

function sidebar(): UiNode {
	return {
		type: 'container',
		direction: 'column',
		width: SIDEBAR_WIDTH,
		sticky: true,
		// The account sits at the bottom, away from the sections.
		justify: 'between',
		children: [
			{ type: 'container', direction: 'column', children: navEntries() },
			{ type: 'container', direction: 'column', children: accountEntries() }
		]
	};
}

function navEntries(): UiNode[] {
	return [
		{
			type: 'textInput',
			label: 'Search',
			placeholder: 'Search',
			search: true,
			suggestions,
			onInput: 'typing',
			onSubmit: 'search'
		},
		...SECTIONS.map((entry): UiNode => ({
			type: 'button',
			label: entry.label,
			variant: 'nav',
			icon: entry.icon,
			selected: entry.id === section && !openCategory && !openProfile,
			onSelect: `nav:${entry.id}`
		}))
	];
}

function accountEntries(): UiNode[] {
	if (!isSignedIn()) {
		return [
			{ type: 'button', label: 'Sign in', variant: 'nav', icon: 'log-in', onSelect: 'signIn' }
		];
	}
	return [
		{ type: 'text', value: account?.displayName ?? 'Signed in', variant: 'title' },
		{ type: 'button', label: 'Sign out', variant: 'nav', icon: 'log-out', onSelect: 'signOut' }
	];
}

function publishScreen() {
	app.publishScreen({
		screenId: SCREEN_ID,
		root: {
			type: 'container',
			direction: 'row',
			alignStart: true,
			children: [
				sidebar(),
				{ type: 'container', direction: 'column', grow: true, children: [mainView()] }
			]
		}
	});
}

function streamToCard(stream: LiveStream): HomeCard {
	return {
		kind: 'suggestion',
		id: stream.login,
		title: stream.title || stream.displayName,
		meta: `${stream.displayName} · ${viewerLabel(stream.viewers)}`,
		image: stream.preview,
		action: { type: 'session', sessionId: stream.login }
	};
}

// Signed in, the home screen shows who you follow, falling back to what's
// popular while nobody you follow is live.
function publishDashboard() {
	const streams = isSignedIn() && following?.length ? following : (browse ?? []);
	app.publishDashboard({
		cards: streams.slice(0, DASHBOARD_CARDS).map(streamToCard)
	});
}

// --- loading -------------------------------------------------------------

// Runs one load, marking `key` failed instead of throwing, then republishes.
async function load(key: string, run: () => Promise<void>) {
	failed.delete(key);
	try {
		await run();
	} catch (err) {
		failed.add(key);
		log('error', `${key} failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	publishScreen();
}

function loadBrowse() {
	return load('browse', async () => {
		browse = await topStreams();
	});
}

function loadFollowing() {
	return load('following', async () => {
		following = await followedLive();
	});
}

// What the dashboard shows, see publishDashboard.
async function loadDashboard() {
	if (isSignedIn()) await loadFollowing();
	if (!isSignedIn() || !following?.length) await loadBrowse();
	publishDashboard();
}

// After signing in or out: the account, its follows and the screen start over.
async function onSessionChanged() {
	account = isSignedIn() ? await currentAccount().catch(() => undefined) : undefined;
	following = undefined;
	openCategory = undefined;
	openProfile = undefined;
	section = isSignedIn() ? 'following' : 'browse';
	publishScreen();
	await loadDashboard();
}

function loadCategories() {
	return load('categories', async () => {
		categories = await topCategories();
	});
}

function loadCategory(id: string) {
	return load(`category:${id}`, async () => {
		const streams = await categoryStreams(id);
		categoryStreamsById.delete(id);
		categoryStreamsById.set(id, streams);
		for (const old of [...categoryStreamsById.keys()].slice(0, -KEEP_CATEGORIES)) {
			categoryStreamsById.delete(old);
		}
	});
}

async function runSearch(query: string) {
	const current: NonNullable<typeof searchState> = { query };
	searchState = current;
	section = 'search';
	openCategory = undefined;
	openProfile = undefined;
	failed.delete('search');
	publishScreen();
	try {
		current.results = await search(query);
	} catch (err) {
		if (searchState === current) failed.add('search');
		log('error', `search "${query}" failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (searchState === current) publishScreen();
}

// --- events --------------------------------------------------------------

let typingTimer: ReturnType<typeof setTimeout> | undefined;

function textOf(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

let suggestionQuery = '';

async function suggest(text: string) {
	suggestionQuery = text;
	let next: string[] = [];
	if (text) {
		try {
			next = await searchSuggestions(text);
		} catch (err) {
			log(
				'error',
				`suggestions for "${text}" failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}
	// A slower answer for text that has since changed would flash old entries.
	if (suggestionQuery !== text) return;
	suggestions = next;
	publishScreen();
}

// Results follow the typing after a short pause, so each keystroke doesn't
// start its own search. Suggestions come with every keystroke.
function onTyping(value: unknown) {
	const text = textOf(value);
	clearTimeout(typingTimer);
	void suggest(text);
	if (text.length >= 2) typingTimer = setTimeout(() => void runSearch(text), 400);
}

// Submitting ends the typing, the keyboard's suggestions go with it. The
// searches that follow the typing (onTyping) leave them.
function onSearch(value: unknown) {
	clearTimeout(typingTimer);
	suggestions = [];
	suggestionQuery = '';
	const text = textOf(value);
	if (text) void runSearch(text);
}

const SECTION_LOADERS: Record<string, () => Promise<unknown>> = {
	following: () => (isSignedIn() ? loadFollowing() : Promise.resolve()),
	categories: loadCategories,
	browse: loadBrowse
};

function onNav(target: string) {
	section = target;
	openCategory = undefined;
	openProfile = undefined;
	publishScreen();
	void SECTION_LOADERS[target]?.();
}

function onSignIn() {
	section = 'following';
	openCategory = undefined;
	openProfile = undefined;
	beginSignIn((status) => {
		// Only once per code, the button stays for sending it again.
		if (status.status === 'pending' && status.userCode !== signInStatus?.userCode) {
			app.openOnPhone(status.phoneUrl);
		}
		signInStatus = status;
		publishScreen();
	})
		.then(() => {
			signInStatus = undefined;
			return onSessionChanged();
		})
		.catch((err: unknown) => {
			// The prompt already shows the code expired or failed, with a retry.
			log('error', err instanceof Error ? err.message : String(err));
			publishScreen();
		});
	publishScreen();
}

async function onSignOut() {
	await signOut();
	await onSessionChanged();
}

function knownCategory(id: string): Category | undefined {
	return (
		categories?.find((category) => category.id === id) ??
		searchState?.results?.categories.find((category) => category.id === id)
	);
}

function onOpenCategory(id: string) {
	openCategory = {
		id,
		name: knownCategory(id)?.name ?? 'Category',
		back: section === 'search' ? 'search' : 'categories'
	};
	publishScreen();
	void loadCategory(id);
}

async function onOpenProfile(login: string) {
	const current: NonNullable<typeof openProfile> = { login };
	openProfile = current;
	openCategory = undefined;
	failed.delete(`profile:${login}`);
	publishScreen();
	try {
		// The videos are extra: a page without them beats no page at all.
		const [profile, videos] = await Promise.all([
			channelProfile(login),
			channelVideos(login).catch((err: unknown) => {
				log(
					'warn',
					`videos of ${login} failed: ${err instanceof Error ? err.message : String(err)}`
				);
				return undefined;
			})
		]);
		current.profile = profile ?? null;
		current.videos = videos;
	} catch (err) {
		if (openProfile === current) failed.add(`profile:${login}`);
		log('error', `profile ${login} failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (openProfile === current) publishScreen();
}

function onBack() {
	openCategory = undefined;
	openProfile = undefined;
	publishScreen();
}

function routeUiEvent(eventId: string, value: unknown) {
	if (eventId === 'typing') return onTyping(value);
	if (eventId === 'search') return onSearch(value);
	if (eventId === 'retrySearch') return searchState && void runSearch(searchState.query);
	if (eventId === 'back') return onBack();
	if (eventId === 'signIn') return onSignIn();
	if (eventId === 'signOut') return void onSignOut();
	const match = /^(nav|category|profile):(.+)$/.exec(eventId);
	if (!match) return;
	const [, kind, arg] = match;
	if (kind === 'nav') onNav(arg);
	else if (kind === 'profile') void onOpenProfile(arg);
	else onOpenCategory(arg);
}

// --- protocol ------------------------------------------------------------

let activated = false;

const app = defineApp((app) => {
	// The session id is the channel login, see streamCard.
	const chat = createChat((sessionId, batch) => app.sendChat(sessionId, batch));

	return {
		onActivate() {
			activated = true;
			return loadSession().then(onSessionChanged);
		},

		// Only number formatting depends on it (app.locale), the next publish picks it up.
		onLocale() {
			if (activated) publishScreen();
		},

		// Live lists go stale within minutes, so the home screen always reloads them.
		onRefreshDashboard() {
			if (activated) void loadDashboard();
		},

		onUiEvent(event) {
			if (event.screenId === SCREEN_ID) routeUiEvent(event.eventId, event.value);
		},

		resolveStream: ({ sessionId }) => resolveStream(sessionId),

		async resolveLiveStatus({ sessionId }) {
			try {
				return { viewers: await viewerCount(sessionId) };
			} catch (err) {
				log('warn', `viewer count for ${sessionId} failed: ${String(err)}`);
				return {};
			}
		},

		onOpenChat: (sessionId) => chat.open(sessionId),
		onCloseChat: (sessionId) => chat.close(sessionId)
	};
});
