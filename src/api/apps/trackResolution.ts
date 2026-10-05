// Shared by the byte-range proxy and its sibling segment-index route (both
// under src/routes/api/stream-track), and by src/routes/api/stream-subtitle
// -- resolving a session's stream (and 404ing consistently when the app
// can't) is identical everywhere it's needed, only what each caller does
// with the result differs (forward video/audio bytes, locate a sidx/Cues
// index, or fetch a subtitle track's own URL).
import { error } from '@sveltejs/kit';
import { getApp } from '#api/apps/manager';
import { resolveStreamCached } from '#api/apps/streamCache';

export function requireTrackName(track: string): 'video' | 'audio' {
	if (track === 'video' || track === 'audio') return track;
	error(400, 'Invalid track');
}

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
