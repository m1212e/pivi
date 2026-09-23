// Entry point run by the host as a child process (see
// src/api/plugins/runtime.ts's loadPlugin). Wires the pieces in this folder
// together against the plugin RPC contract in src/lib/plugins/host.ts:
// login (auth.ts), browsing — this account's personalized home feed
// (tvHomeFeed.ts), signed in only, no generic/anonymous fallback — and
// playback (stream.ts, resolved on demand by resolveStreamRequest — the
// host's generic streaming proxy calls this, not this plugin, so playback
// itself is entirely the host's concern).
import {
	activateNotification,
	logNotification,
	profileChangedNotification,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	resolveSkipSegmentsRequest,
	resolveStreamRequest,
	shutdownNotification,
	uiEventNotification
} from '#lib/plugins/host';
import type { HomeCard } from '#lib/plugins/dashboard';
import type { UiNode } from '#lib/plugins/ui';
import { connection } from './connection';
import { manifest } from './manifest';
import { beginSignIn, isSignedIn } from './auth';
import { fetchTvHomeFeed } from './tvHomeFeed';
import type { VideoSummary } from './youtubeClient';
import { resolveStream } from './stream';
import { fetchSkipSegments } from './sponsorBlock';
import { innertube, loadSessionForActiveProfile } from './innertube';

const SCREEN_ID = 'browse';

function log(level: 'info' | 'warn' | 'error', message: string) {
	connection.sendNotification(logNotification, { level, message });
}

// A `session` action, not `deepLink` — the video id doubles as the session
// id since it's already exactly what resolveStream (below) needs, and it
// takes the card straight to the shared player route (see
// #lib/plugins/dashboard's pluginActionHref) without this plugin needing to
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

function browseScreen(results: VideoSummary[]): UiNode {
	return {
		type: 'container',
		direction: 'column',
		children: [
			// Sign-in is a manual action, not something gating activation --
			// the screen itself still opens signed out, just with an empty
			// list and this button instead of the personalized feed below.
			isSignedIn()
				? { type: 'text', value: 'Signed in', variant: 'subtitle' }
				: { type: 'button', label: 'Sign in with Google', onSelect: 'signIn' },
			{
				type: 'list',
				items: results.map((video) => ({
					type: 'container',
					direction: 'row',
					children: [
						{ type: 'image', src: video.thumbnailUrl, aspect: 'video' },
						{ type: 'text', value: video.title, variant: 'title' },
						{ type: 'text', value: video.channelTitle, variant: 'subtitle' },
						{
							type: 'button',
							label: 'Play',
							action: { type: 'session', sessionId: video.id }
						}
					]
				}))
			}
		]
	};
}

function publishScreen(results: VideoSummary[]) {
	connection.sendNotification(publishScreenNotification, {
		pluginId: manifest.id,
		screenId: SCREEN_ID,
		root: browseScreen(results)
	});
}

// Module scope (not activate()'s own local) since a profile switch needs to
// re-run this after activate() has already run once — see main()'s
// profileChangedNotification handler.
let lastResults: VideoSummary[] = [];

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
		// lastResults is module scope (see above), so without this a profile
		// switch to a signed-out (or never-signed-in) profile would otherwise
		// republish whichever profile's videos happened to be signed in last
		// -- this plugin process is shared across every pivi profile, not one
		// instance per user. No signed-out fallback content on purpose: this
		// plugin only ever showed generic/anonymous trending because it
		// briefly needed *some* content source before sign-in worked
		// (invidious.ts, now removed) -- there's nothing worth showing here
		// without a signed-in account, and browseScreen already surfaces the
		// "Sign in with Google" button.
		lastResults = [];
	}

	connection.sendNotification(publishDashboardNotification, {
		pluginId: manifest.id,
		cards: lastResults.map(videoToCard)
	});
	publishScreen(lastResults);
}

function main() {
	connection.sendNotification(readyNotification, manifest);

	// Registered before anything is awaited, so an 'activate' that arrives
	// while loadSessionForActiveProfile() (below) is still in flight is
	// never missed.
	connection.onNotification(activateNotification, () => {
		activate().catch((err: unknown) => {
			log('error', err instanceof Error ? err.message : String(err));
		});
	});

	connection.onNotification(shutdownNotification, () => process.exit(0));

	// The host's streaming proxy calls this on demand (see
	// src/routes/api/stream/[pluginId]/[sessionId]) — sessionId is just the
	// video id for this plugin, an opaque string as far as the host's
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
	// trusted — see loadSessionForActiveProfile's own comment for why this
	// can't just run at module load instead.
	await loadSessionForActiveProfile();
	await refresh();

	// Not registered until the initial load above has actually finished --
	// loadSessionForActiveProfile() swaps out the exact `innertube` instance
	// that same call is still setting up, so an overlapping profile switch
	// mid-startup could otherwise let whichever finishes last silently
	// clobber the other's result.
	connection.onNotification(profileChangedNotification, () => {
		loadSessionForActiveProfile()
			.then(refresh)
			.catch((err: unknown) => log('error', err instanceof Error ? err.message : String(err)));
	});

	connection.onNotification(uiEventNotification, (event) => {
		if (event.screenId !== SCREEN_ID) return;

		if (event.eventId === 'signIn') {
			// A real refresh now, not just re-publishing the screen — signing
			// in switches the feed itself over to this account's real
			// personalized one (tvHomeFeed.ts), not just the "Signed in" label.
			beginSignIn()
				.then(() => refresh())
				.catch((err: unknown) => log('error', err instanceof Error ? err.message : String(err)));
		}
	});
}

main();
