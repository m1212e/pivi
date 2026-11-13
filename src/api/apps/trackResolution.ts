// Shared by the stream-track proxy and index routes and the stream-subtitle
// route, so they all resolve a session the same way and fail with the same 404.
import { error } from '@sveltejs/kit';
import { getApp } from '#api/apps/manager';
import { resolveStreamCached } from '#api/apps/streamCache';
import type { ResolvedStream } from '#sdk/protocol';
import { fetchAppUrl, type AppFetchInit } from './appFetch';
import type { AppInstance } from './runtime';

/** Rejects a `[track]` route param that isn't video or audio before it picks a URL. */
export function requireTrackName(track: string): 'video' | 'audio' {
	if (track === 'video' || track === 'audio') return track;
	error(400, 'Invalid track');
}

/**
 * Used by the stream-subtitle route, which needs the whole resolved stream.
 * Any failure becomes a 404 so an app that can't serve a session doesn't
 * show up as a server error. The app comes along so the route can fetch its
 * URLs through fetchAppUrl.
 */
export async function resolveStreamOrError(
	appId: string,
	sessionId: string,
	maxHeight: number | undefined
): Promise<{ app: AppInstance; stream: ResolvedStream }> {
	try {
		const app = await getApp(appId);
		return { app, stream: await resolveStreamCached(appId, sessionId, app, maxHeight) };
	} catch (err) {
		error(404, err instanceof Error ? err.message : 'Could not resolve stream');
	}
}

/**
 * The CDN url the stream-track routes proxy bytes from or read the segment
 * index of, with a fetch bound to it that keeps redirects to what the app may
 * reach. 404s when the stream has no such track.
 */
export async function resolveTrack(
	appId: string,
	sessionId: string,
	track: 'video' | 'audio',
	maxHeight: number | undefined
): Promise<{ url: string; fetch: (init?: AppFetchInit) => Promise<Response> }> {
	const { app, stream } = await resolveStreamOrError(appId, sessionId, maxHeight);
	const url = track === 'video' ? stream.videoUrl : stream.audioUrl;
	if (!url) error(404, `No ${track} track for this session`);
	return { url, fetch: (init) => fetchAppUrl(app, url, init) };
}
