// Locates the sidx (mp4) or Cues (webm) segment index already baked into
// the resolved CDN file, so the browser's manifest (#lib/mse/dualTrackPlayer)
// can point Shaka's SegmentBase at a real byte range instead of guessing.
// See src/api/plugins/containerIndex.ts for why this index already exists
// in these files without us having to build one ourselves.
import { error, json } from '@sveltejs/kit';
import { requireTrackName, resolveTrackUrl } from '#api/plugins/trackResolution';
import { buildSegmentBaseIndexCached } from '#api/plugins/containerIndexCache';
import type { RequestHandler } from './$types';

function requireContainer(value: string | null): 'mp4' | 'webm' {
	if (value === 'mp4' || value === 'webm') return value;
	error(400, 'Invalid or missing container');
}

export const GET: RequestHandler = async ({ params, url }) => {
	const { pluginId, sessionId } = params;
	const track = requireTrackName(params.track);
	const container = requireContainer(url.searchParams.get('container'));
	const maxHeight = Number(url.searchParams.get('quality')) || undefined;

	const targetUrl = await resolveTrackUrl(pluginId, sessionId, track, maxHeight);
	const index = await buildSegmentBaseIndexCached(targetUrl, container);
	return json(index);
};
