// The HLS counterpart of stream-track: serves a session's HLS playlist (see
// @pivi/sdk/protocol's `videoContainer: 'hls'`) and everything it references, so
// the player (#lib/playback/hlsPlayer) never talks to the app's CDN itself.
//
// Without `?u=` this is the session's own playlist, `[file]` being just a
// name ending in .m3u8. With it, `u` is an upstream URL some playlist served
// here referenced, and `s` the signature hlsPlaylist.ts put next to it, so
// nothing else can be fetched through this route. Playlists are rewritten on
// the way through, segments are relayed untouched with Range forwarded.
import { error } from '@sveltejs/kit';
import {
	assertAppUrl,
	fetchAppUrlFollowed,
	readTextCapped,
	type AppFetchInit
} from '#api/apps/appFetch';
import {
	hlsLinkBuilder,
	isPlaylist,
	rewritePlaylist,
	verifyHlsSignature
} from '#api/apps/hlsPlaylist';
import { getApp } from '#api/apps/manager';
import type { AppInstance } from '#api/apps/runtime';
import { resolveStreamOrError } from '#api/apps/trackResolution';
import type { RequestHandler } from './$types';

// A master playlist is a few KB, a live media playlist a few dozen.
const MAX_PLAYLIST_BYTES = 2 << 20;

const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

type Target = { app: AppInstance; url: string };

async function sessionPlaylist(appId: string, sessionId: string, url: URL): Promise<Target> {
	const maxHeight = Number(url.searchParams.get('quality')) || undefined;
	const { app, stream } = await resolveStreamOrError(appId, sessionId, maxHeight);
	if (stream.videoContainer !== 'hls') error(404, 'This session is not an HLS stream');
	return { app, url: stream.videoUrl };
}

async function referencedResource(
	appId: string,
	sessionId: string,
	upstream: string,
	signature: string | null
): Promise<Target> {
	if (!signature || !verifyHlsSignature(appId, sessionId, upstream, signature)) {
		error(403, 'Unknown HLS resource');
	}
	try {
		const app = await getApp(appId);
		// Signed means a playlist named it, not that it's allowed. A playlist can
		// point anywhere, so each URL gets the check resolved URLs get.
		await assertAppUrl(app, upstream);
		return { app, url: upstream };
	} catch (err) {
		console.warn(`[stream-hls] ${appId}: refused ${new URL(upstream).hostname}: ${String(err)}`);
		error(403, err instanceof Error ? err.message : 'Refused');
	}
}

function forwardedHeaders(upstream: Response): Headers {
	const headers = new Headers();
	for (const key of FORWARDED_HEADERS) {
		const value = upstream.headers.get(key);
		if (value) headers.set(key, value);
	}
	return headers;
}

async function playlistResponse(
	upstream: Response,
	base: string,
	appId: string,
	sessionId: string
): Promise<Response> {
	const text = await readTextCapped(upstream, MAX_PLAYLIST_BYTES).catch(() =>
		error(502, 'Playlist too large')
	);
	return new Response(rewritePlaylist(text, base, hlsLinkBuilder(appId, sessionId)), {
		headers: {
			'content-type': 'application/vnd.apple.mpegurl',
			// A live playlist changes every few seconds.
			'cache-control': 'no-store'
		}
	});
}

export const GET: RequestHandler = async ({ params, url, request }) => {
	const { appId, sessionId } = params;
	const upstreamParam = url.searchParams.get('u');
	const target = upstreamParam
		? await referencedResource(appId, sessionId, upstreamParam, url.searchParams.get('s'))
		: await sessionPlaylist(appId, sessionId, url);

	const range = request.headers.get('range');
	const init: AppFetchInit = {
		method: request.method === 'HEAD' ? 'HEAD' : 'GET',
		headers: range ? { range } : {},
		signal: request.signal
	};
	const { response: upstream, url: finalUrl } = await fetchAppUrlFollowed(
		target.app,
		target.url,
		init
	).catch((err: unknown) => error(502, err instanceof Error ? err.message : 'Upstream failed'));

	if (!upstream.ok) {
		await upstream.body?.cancel();
		// An ended live stream answers its playlist with 404, which the player
		// should see as such rather than as a proxy failure.
		error(upstream.status === 404 ? 404 : 502, `Upstream answered ${upstream.status}`);
	}

	if (init.method === 'GET' && isPlaylist(upstream.headers.get('content-type'), finalUrl)) {
		return playlistResponse(upstream, finalUrl, appId, sessionId);
	}
	return new Response(upstream.body, {
		status: upstream.status,
		headers: forwardedHeaders(upstream)
	});
};
