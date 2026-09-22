// Entry point run by the host as a child process (see
// src/api/plugins/runtime.ts's loadPlugin). Wires the pieces in this folder
// together against the plugin RPC contract in src/lib/plugins/host.ts:
// login (auth.ts), browsing — this account's personalized home feed
// (tvHomeFeed.ts), signed in only, no generic/anonymous fallback — and
// playback (stream.ts + a session request).
import {
	activateNotification,
	logNotification,
	profileChangedNotification,
	publishDashboardNotification,
	publishScreenNotification,
	readyNotification,
	requestSessionRequest,
	requestSessionResultSchema,
	sessionEndedNotification,
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
import { innertube, loadSessionForActiveProfile } from './innertube';

const SCREEN_ID = 'browse';

function log(level: 'info' | 'warn' | 'error', message: string) {
	connection.sendNotification(logNotification, { level, message });
}

// Same "play:<id>" convention the browse screen's own Play buttons use
// (onEvent below) — a dashboard card and a browse-screen row ending up at
// the same video go through one shared event, not two.
function videoToCard(video: VideoSummary): HomeCard {
	return {
		kind: 'suggestion',
		id: video.id,
		title: video.title,
		meta: video.channelTitle,
		image: video.thumbnailUrl,
		action: { type: 'deepLink', target: `play:${video.id}` }
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
						{ type: 'button', label: 'Play', onSelect: `play:${video.id}` }
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

async function playVideo(videoId: string, title: string) {
	log('info', `Resolving stream for ${videoId}`);
	const { videoUrl, audioUrl } = await resolveStream(videoId);
	const result = requestSessionResultSchema.parse(
		await connection.sendRequest(requestSessionRequest, {
			pluginId: manifest.id,
			sessionId: `youtube-${videoId}-${Date.now()}`,
			needs: ['display-exclusive'],
			media: { url: videoUrl, audioUrl, title }
		})
	);
	if (!result.granted) log('warn', 'Playback session was not granted');
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

	// Otherwise a playback failure (e.g. mpv missing/failing to start) is
	// silent — the session request itself only reports whether it was
	// *granted*, not how the session actually ended.
	connection.onNotification(sessionEndedNotification, (ended) => {
		if (ended.reason === 'error') log('error', `Playback session ended: ${ended.message}`);
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
			return;
		}

		if (event.eventId.startsWith('play:')) {
			const videoId = event.eventId.slice('play:'.length);
			const video = lastResults.find((v) => v.id === videoId);
			playVideo(videoId, video?.title ?? videoId).catch((err: unknown) =>
				log('error', err instanceof Error ? err.message : String(err))
			);
		}
	});
}

main();
