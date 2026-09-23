// A thin byte-range relay -- no muxing, no transcoding, just forwards
// whatever Range header the browser's MSE pump (#lib/mse/dualTrackPlayer)
// asked for straight to the resolved CDN URL and streams the response back
// untouched. This is what lets the browser do its own buffering via two
// MediaSource SourceBuffers instead of a live ffmpeg remux -- the same
// mechanism a real DASH player uses for split video/audio adaptation sets,
// just with this route standing in for direct CORS-friendly access to the
// underlying CDN. Generic over any plugin: it only ever touches the generic
// ResolvedStream shape (src/routes/api/stream is the same way).
import { requireTrackName, resolveTrackUrl } from '#api/plugins/trackResolution';
import type { RequestHandler } from './$types';

function forwardableHeaders(upstream: Response): Headers {
	const headers = new Headers();
	for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
		const value = upstream.headers.get(key);
		if (value) headers.set(key, value);
	}
	return headers;
}

export const GET: RequestHandler = async ({ params, url, request }) => {
	const { pluginId, sessionId } = params;
	const track = requireTrackName(params.track);
	const maxHeight = Number(url.searchParams.get('quality')) || undefined;
	const targetUrl = await resolveTrackUrl(pluginId, sessionId, track, maxHeight);

	// Forwarded verbatim -- both the MSE pump's own range requests and
	// Shaka's segment/index fetches ask for specific byte windows, not the
	// whole file at once.
	const range = request.headers.get('range');
	const upstream = await fetch(targetUrl, range ? { headers: { range } } : {});

	return new Response(upstream.body, {
		status: upstream.status,
		headers: forwardableHeaders(upstream)
	});
};
