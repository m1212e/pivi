// Shared by the byte-range proxy and its sibling segment-index route (both
// under src/routes/api/stream-track) -- resolving which track URL a
// {pluginId, sessionId, track} triple points at is identical for both, only
// what they do with that URL differs (forward bytes vs. locate a sidx/Cues
// index).
import { error } from '@sveltejs/kit';
import { getPlugin } from '#api/plugins/manager';
import { resolveStreamCached } from '#api/plugins/streamCache';

export function requireTrackName(track: string): 'video' | 'audio' {
	if (track === 'video' || track === 'audio') return track;
	error(400, 'Invalid track');
}

async function resolveStreamOrError(
	pluginId: string,
	sessionId: string,
	maxHeight: number | undefined
) {
	try {
		const plugin = await getPlugin(pluginId);
		return await resolveStreamCached(pluginId, sessionId, plugin, maxHeight);
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
	pluginId: string,
	sessionId: string,
	track: 'video' | 'audio',
	maxHeight: number | undefined
): Promise<string> {
	const resolved = await resolveStreamOrError(pluginId, sessionId, maxHeight);
	const targetUrl = trackUrlFrom(resolved, track);
	if (!targetUrl) error(404, `No ${track} track for this session`);
	return targetUrl;
}
