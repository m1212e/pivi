// The one way the host fetches a URL an app supplied (stream bytes, segment
// indexes, captions). Checking the URL once isn't enough: an allowed CDN
// answering with a redirect to 192.168.x.x would get the host to fetch from the
// LAN anyway. So redirects are followed by hand, and every hop is held to the
// same rules as the URL the app handed over.
//
// ffmpeg (routes/api/stream) fetches on its own and follows redirects itself,
// so this can't cover it. Its inputs are still checked up front by streamCache.ts.
import type { AppInstance } from './runtime';
import { assertPublicHost, UnsafeUrlError } from './urlGuard';

// CDNs chain a hop or two (a load balancer, a regional edge). More than this
// is a loop or something stranger.
const MAX_REDIRECTS = 5;

/**
 * On a domain the app declared and the user allowed, and resolving to public
 * addresses only. Used by streamCache.ts on every resolved URL and here on
 * every redirect hop.
 */
export async function assertAppUrl(app: AppInstance, url: string): Promise<void> {
	if (!app.allowsUrl(url)) {
		throw new UnsafeUrlError(`${app.manifest.id} returned a URL outside its allowed domains`);
	}
	await assertPublicHost(new URL(url).hostname);
}

/** fetch() for app-supplied URLs. Assumes `url` itself was checked with assertAppUrl. */
export async function fetchAppUrl(
	app: AppInstance,
	url: string,
	init: RequestInit = {}
): Promise<Response> {
	let current = url;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const response = await fetch(current, { ...init, redirect: 'manual' });
		const location = response.headers.get('location');
		if (response.status < 300 || response.status >= 400 || !location) return response;

		await response.body?.cancel();
		const next = new URL(location, current).toString();
		await assertAppUrl(app, next);
		current = next;
	}
	throw new UnsafeUrlError(`${app.manifest.id}: too many redirects`);
}
