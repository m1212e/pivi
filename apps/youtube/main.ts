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
	PROTOCOL_VERSION,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	resolveSkipSegmentsRequest,
	resolveStreamRequest,
	shutdownNotification,
	uiEventNotification
} from '#lib/apps/host';
import type { HomeCard } from '#lib/apps/dashboard';
import type { UiNode } from '#lib/apps/ui';
import { connection } from './connection';
import { beginSignIn, isSignedIn, type DeviceCodeAuth } from './auth';
import { fetchTvHomeFeed } from './tvHomeFeed';
import type { VideoSummary } from './youtubeClient';
import { resolveStream } from './stream';
import { fetchSkipSegments } from './sponsorBlock';
import { innertube, loadStoredSession } from './innertube';

const SCREEN_ID = 'browse';

// Matches the real YouTube site's home feed: a grid of cards (thumbnail,
// title, channel) that wraps across the available width, the whole card
// clickable -- rather than a vertical list with a separate "Play" button.
// A fixed width is needed on both the card and its thumbnail (see UiNode's
// own comment) so titles wrap within the card instead of stretching it.
const CARD_WIDTH = '16rem';

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
		children: [
			{ type: 'text', value: `Sign in at ${auth.verificationUrl}`, variant: 'subtitle' },
			{ type: 'text', value: auth.userCode, variant: 'title' },
			{ type: 'text', value: `Status: ${auth.status}`, variant: 'body' },
			{
				type: 'button',
				label: 'Open on your phone',
				action: { type: 'openOnPhone', url: auth.verificationUrl }
			}
		]
	};
}

// One grid card -- the whole thing is the "Play" action (via the container's
// own `action`, same as videoToCard's dashboard suggestion), so there's no
// separate button competing with it for the eye or for remote focus.
function videoCard(video: VideoSummary): UiNode {
	return {
		type: 'container',
		direction: 'column',
		width: CARD_WIDTH,
		action: { type: 'session', sessionId: video.id },
		children: [
			{
				type: 'image',
				src: video.thumbnailUrl,
				aspect: 'video',
				width: CARD_WIDTH,
				badge: video.durationText || undefined
			},
			{ type: 'text', value: video.title, variant: 'title', lines: 2 },
			{ type: 'text', value: video.channelTitle, variant: 'subtitle' }
		]
	};
}

function browseScreen(results: VideoSummary[], signIn: DeviceCodeAuth | undefined): UiNode {
	// Sign-in is a manual action, not something gating activation -- the
	// screen itself still opens signed out, just with an empty grid and this
	// prompt instead of the personalized feed below. Signed in just shows the
	// grid, no separate label -- the feed being personalized is already the
	// signal that it's wired up.
	const signInNode: UiNode | undefined = isSignedIn()
		? undefined
		: signIn
			? signInPrompt(signIn)
			: { type: 'button', label: 'Sign in with Google', onSelect: 'signIn' };

	return {
		type: 'container',
		direction: 'column',
		children: [
			...(signInNode ? [signInNode] : []),
			{
				type: 'container',
				direction: 'row',
				wrap: true,
				children: results.map(videoCard)
			}
		]
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
// The in-progress device-code prompt, while beginSignIn() is running —
// undefined the rest of the time (signed in, or not yet started).
let signInStatus: DeviceCodeAuth | undefined;

async function refresh() {
	if (isSignedIn()) {
		try {
			lastResults = await fetchTvHomeFeed(innertube);
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
	}

	connection.sendNotification(publishDashboardNotification, {
		cards: lastResults.map(videoToCard)
	});
	publishScreen(lastResults);
}

function main() {
	connection.sendNotification(readyNotification, { protocol: PROTOCOL_VERSION });

	// Registered right after ready is sent, before anything is awaited, so an
	// 'activate' that arrives straight away is never missed.
	connection.onNotification(activateNotification, () => {
		activate().catch((err: unknown) => {
			log('error', err instanceof Error ? err.message : String(err));
		});
	});

	connection.onNotification(shutdownNotification, () => process.exit(0));

	// The host's streaming proxy calls this on demand (see
	// src/routes/api/stream/[appId]/[sessionId]) — sessionId is just the
	// video id for this app, an opaque string as far as the host's
	// concerned, same as a deepLink target already is.
	connection.onRequest(resolveStreamRequest, ({ sessionId, maxHeight }) =>
		resolveStream(sessionId, maxHeight)
	);

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

async function activate() {
	// Needed before isSignedIn() (refresh()/browseScreen(), below) can be
	// trusted — see loadStoredSession's own comment.
	await loadStoredSession();
	await refresh();

	connection.onNotification(uiEventNotification, (event) => {
		if (event.screenId !== SCREEN_ID) return;

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
