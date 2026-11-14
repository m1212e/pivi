// Entry point of the Twitch app image: speaks the host protocol (see
// sdk/protocol.ts) over stdin/stdout. Browsing comes from Twitch's GQL API
// (gql.ts), as the signed-in account when there is one (auth.ts), playback
// from stream.ts, which hands the host a live HLS playlist, and chat from
// chat.ts. Playing it is the host's job (the stream-hls proxy and the shared
// player), the session id is just the channel login.
//
// Everything personal (who is signed in, whom they follow) is asked of Twitch
// when shown, never kept here: the token is the only thing stored.
import {
	activateNotification,
	chatMessagesNotification,
	closeChatNotification,
	localeNotification,
	openChatNotification,
	openOnPhoneNotification,
	PROTOCOL_VERSION,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	refreshDashboardNotification,
	resolveLiveStatusRequest,
	resolveStreamRequest,
	shutdownNotification,
	uiEventNotification
} from '../../sdk/protocol';
import type { HomeCard } from '../../sdk/dashboard';
import type { UiNode } from '../../sdk/ui';
import { connection } from './connection';
import { beginSignIn, isSignedIn, loadSession, signOut, type DeviceCodeAuth } from './auth';
import { createChat } from './chat';
import {
	categoryStreams,
	currentAccount,
	followedLive,
	search,
	topCategories,
	topStreams,
	viewerCount,
	type Account,
	type Category,
	type Channel,
	type LiveStream,
	type SearchResults
} from './gql';
import { resolveStream } from './stream';

const SCREEN_ID = 'browse';
const SIDEBAR_WIDTH = '14rem';
const DASHBOARD_CARDS = 15;
const EMPTY_ERROR = "Couldn't load this right now.";

// Material-style 24x24 icon paths, so the sidebar needs no image assets.
const SECTIONS = [
	{
		id: 'following',
		label: 'Following',
		icon: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z'
	},
	{
		id: 'browse',
		label: 'Live now',
		icon: 'M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 14H3V8h18z'
	},
	{
		id: 'categories',
		label: 'Categories',
		icon: 'M4 8h4V4H4zm6 12h4v-4h-4zm-6 0h4v-4H4zm0-6h4v-4H4zm6 0h4v-4h-4zm6-10v4h4V4zm-6 4h4V4h-4zm6 6h4v-4h-4zm0 6h4v-4h-4z'
	}
];
const ACCOUNT_ICON =
	'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z';
const LIVE_ICON =
	'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-5.66 7.66A8 8 0 0 1 6.34 6.34l1.42 1.42a6 6 0 0 0 0 8.48zm11.32 0-1.42-1.42a6 6 0 0 0 0-8.48l1.42-1.42a8 8 0 0 1 0 11.32z';

function log(level: 'info' | 'warn' | 'error', message: string) {
	console.error(`[${level}] ${message}`);
}

let locale = 'en';

function viewerLabel(viewers: number): string {
	const count = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
	return `${count.format(viewers)} viewers`;
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

// Offline channels are listed so a search for one doesn't look like it found
// nothing, but there's nothing to play.
function channelCard(channel: Channel): UiNode {
	if (channel.stream) return streamCard(channel.stream);
	return {
		type: 'mediaCard',
		title: channel.displayName,
		meta: 'Offline',
		image: channel.avatar,
		shape: 'avatar'
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

function categoryView(open: NonNullable<typeof openCategory>): UiNode {
	const streams = categoryStreamsById.get(open.id);
	let body: UiNode;
	if (!streams) body = pending(`category:${open.id}`, `category:${open.id}`);
	else if (streams.length === 0) body = statusMessage(`Nobody is live in ${open.name}.`);
	else body = grid(streams.map(streamCard), open.name);
	return {
		type: 'container',
		direction: 'column',
		children: [{ type: 'button', label: BACK_LABELS[open.back], onSelect: 'back' }, body]
	};
}

function searchView(): UiNode {
	if (!searchState) return statusMessage('Type something to search.');
	const { query, results } = searchState;
	if (!results) return pending('search', 'retrySearch');
	const { channels, categories: found } = results;
	if (channels.length === 0 && found.length === 0)
		return statusMessage(`No results for "${query}".`);
	return {
		type: 'container',
		direction: 'column',
		children: [
			...(found.length
				? [{ type: 'shelf', title: 'Categories', children: found.map(categoryCard) } as UiNode]
				: []),
			grid(channels.map(channelCard), `Channels for "${query}"`)
		]
	};
}

function mainView(): UiNode {
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
		children: [
			{
				type: 'textInput',
				label: 'Search',
				placeholder: 'Search',
				search: true,
				onInput: 'typing',
				onSubmit: 'search'
			},
			...SECTIONS.map((entry): UiNode => ({
				type: 'button',
				label: entry.label,
				variant: 'nav',
				icon: entry.icon,
				selected: entry.id === section && !openCategory,
				onSelect: `nav:${entry.id}`
			})),
			...accountEntries()
		]
	};
}

function accountEntries(): UiNode[] {
	if (!isSignedIn()) {
		return [
			{ type: 'button', label: 'Sign in', variant: 'nav', icon: ACCOUNT_ICON, onSelect: 'signIn' }
		];
	}
	return [
		{ type: 'text', value: account?.displayName ?? 'Signed in', variant: 'title' },
		{ type: 'button', label: 'Sign out', variant: 'nav', icon: ACCOUNT_ICON, onSelect: 'signOut' }
	];
}

function publishScreen() {
	connection.sendNotification(publishScreenNotification, {
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
	connection.sendNotification(publishDashboardNotification, {
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

// Results follow the typing after a short pause, so each keystroke doesn't
// start its own search.
function onTyping(value: unknown) {
	const text = textOf(value);
	clearTimeout(typingTimer);
	if (text.length >= 2) typingTimer = setTimeout(() => void runSearch(text), 400);
}

function onSearch(value: unknown) {
	clearTimeout(typingTimer);
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
	publishScreen();
	void SECTION_LOADERS[target]?.();
}

function onSignIn() {
	section = 'following';
	openCategory = undefined;
	beginSignIn((status) => {
		// Only once per code, the button stays for sending it again.
		if (status.status === 'pending' && status.userCode !== signInStatus?.userCode) {
			connection.sendNotification(openOnPhoneNotification, { url: status.phoneUrl });
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

function onBack() {
	openCategory = undefined;
	publishScreen();
}

function routeUiEvent(eventId: string, value: unknown) {
	if (eventId === 'typing') return onTyping(value);
	if (eventId === 'search') return onSearch(value);
	if (eventId === 'retrySearch') return searchState && void runSearch(searchState.query);
	if (eventId === 'back') return onBack();
	if (eventId === 'signIn') return onSignIn();
	if (eventId === 'signOut') return void onSignOut();
	const match = /^(nav|category):(.+)$/.exec(eventId);
	if (!match) return;
	const [, kind, arg] = match;
	if (kind === 'nav') onNav(arg);
	else onOpenCategory(arg);
}

// --- protocol ------------------------------------------------------------

let activated = false;

function main() {
	connection.sendNotification(readyNotification, { protocol: PROTOCOL_VERSION });

	// Registered right after ready, before anything is awaited, so an activate
	// that arrives straight away is never missed.
	connection.onNotification(activateNotification, (params) => {
		locale = params.locale;
		activated = true;
		void loadSession().then(onSessionChanged);
	});

	// Only number formatting depends on it, the next publish picks it up.
	connection.onNotification(localeNotification, (params) => {
		locale = params.locale;
		if (activated) publishScreen();
	});

	// Live lists go stale within minutes, so the home screen always reloads them.
	connection.onNotification(refreshDashboardNotification, () => {
		if (activated) void loadDashboard();
	});

	connection.onNotification(uiEventNotification, (event) => {
		if (event.screenId === SCREEN_ID) routeUiEvent(event.eventId, event.value);
	});

	connection.onNotification(shutdownNotification, () => process.exit(0));

	// The session id is the channel login, see streamCard.
	connection.onRequest(resolveStreamRequest, ({ sessionId }) => resolveStream(sessionId));

	connection.onRequest(resolveLiveStatusRequest, async ({ sessionId }) => {
		try {
			return { viewers: await viewerCount(sessionId) };
		} catch (err) {
			log('warn', `viewer count for ${sessionId} failed: ${String(err)}`);
			return {};
		}
	});

	const chat = createChat((sessionId, batch) =>
		connection.sendNotification(chatMessagesNotification, { sessionId, ...batch })
	);
	connection.onNotification(openChatNotification, ({ sessionId }) => chat.open(sessionId));
	connection.onNotification(closeChatNotification, ({ sessionId }) => chat.close(sessionId));
}

main();
