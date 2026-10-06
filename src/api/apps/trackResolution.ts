// Shared by the stream-track proxy and index routes and the stream-subtitle
// route, so they all resolve a session the same way and fail with the same 404.
import { error } from '@sveltejs/kit';
import { getApp } from '#api/apps/manager';
import { resolveStreamCached } from '#api/apps/streamCache';

/** Rejects a `[track]` route param that isn't video or audio before it picks a URL. */
export function requireTrackName(track: string): 'video' | 'audio' {
	if (track === 'video' || track === 'audio') return track;
	error(400, 'Invalid track');
}

/**
 * Used by the stream-subtitle route, which needs the whole resolved stream.
 * Any failure becomes a 404 so an app that can't serve a session doesn't
 * show up as a server error.
 */
export async function resolveStreamOrError(
	appId: string,
	sessionId: string,
	maxHeight: number | undefined
) {
	try {
		const app = await getApp(appId);
		return await resolveStreamCached(appId, sessionId, app, maxHeight);
	} catch (err) {
		error(404, err instanceof Error ? err.message : 'Could not resolve stream');
	}
}

function trackUrlFrom(
	resolved: Awaited<ReturnType<typeof resolveStreamOrError>>,
	track: 'video' | 'audio'
): string | undefined {
	return track === 'video' ? resolved.videoUrl : resolved.audioUrl;
}

/**
 * The CDN url the stream-track routes proxy bytes from or read the segment
 * index of. 404s when the stream has no such track.
 */
export async function resolveTrackUrl(
	appId: string,
	sessionId: string,
	track: 'video' | 'audio',
	maxHeight: number | undefined
): Promise<string> {
	const resolved = await resolveStreamOrError(appId, sessionId, maxHeight);
	const targetUrl = trackUrlFrom(resolved, track);
	if (!targetUrl) error(404, `No ${track} track for this session`);
	return targetUrl;
}
