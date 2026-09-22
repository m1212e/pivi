// Entry point run by the host as a child process (see
// src/api/plugins/runtime.ts's loadPlugin). Wires the pieces in this folder
// together against the plugin RPC contract in src/lib/plugins/host.ts:
// login (auth.ts), browsing — personalized (tvHomeFeed.ts) when signed in,
// generic trending (invidious.ts) otherwise — and playback (stream.ts + a
// session request).
import {
	activateNotification,
	logNotification,
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
import { fetchTrending } from './invidious';
import { fetchTvHomeFeed } from './tvHomeFeed';
import type { VideoSummary } from './youtubeClient';
import { resolveStream } from './stream';
import { innertube, restoreSession } from './innertube';

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
			// Signed in: the list below is this account's real personalized
			// home feed (tvHomeFeed.ts). Signed out: Invidious's generic
			// trending (invidious.ts) — sign-in is a manual action, not
			// something gating activation, since browsing works fine without it.
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

function main() {
	connection.sendNotification(readyNotification, manifest);

	// Registered before anything is awaited, so an 'activate' that arrives
	// while restoreSession() (below) is still in flight is never missed.
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

	// Fire-and-forget here purely as a head start — the host can only look
	// up a stored credential once it knows this plugin's manifest, which the
	// readyNotification just above is what tells it, so this couldn't run
	// any earlier. activate() awaits the same cached promise before it
	// needs the answer, so this isn't required for correctness, just so a
	// sign-in that was already there doesn't wait on activate() to kick it off.
	restoreSession().catch(() => {});
}

async function activate() {
	let lastResults: VideoSummary[] = [];

	async function refresh() {
		if (isSignedIn()) {
			try {
				lastResults = await fetchTvHomeFeed(innertube);
			} catch (err) {
				// TV's home feed is undocumented internal API — a shape change
				// or a transient failure shouldn't take the whole dashboard
				// down with it, so this falls back the same way a signed-out
				// session does.
				const info = (err as { info?: unknown } | undefined)?.info;
				log(
					'error',
					`TV home feed failed, falling back to trending: ${String(err)} info=${JSON.stringify(info)}`
				);
			}
		}
		if (lastResults.length === 0) lastResults = await fetchTrending();

		connection.sendNotification(publishDashboardNotification, {
			pluginId: manifest.id,
			cards: lastResults.map(videoToCard)
		});
		publishScreen(lastResults);
	}

	// Needed before isSignedIn() (refresh()/browseScreen(), below) can be
	// trusted — see restoreSession's own comment for why this can't just run
	// at module load instead.
	await restoreSession();
	await refresh();

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
