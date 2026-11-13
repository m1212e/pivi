// The one way the host fetches a URL an app supplied (stream bytes, segment
// indexes, captions, and ffmpeg's input through ffmpegRelay.ts). Checking the
// URL once isn't enough: an allowed CDN answering with a redirect to
// 192.168.x.x would get the host to fetch from the LAN anyway. So redirects are
// followed by hand, every hop is held to the same rules as the URL the app
// handed over, and fetchPublic checks the address it actually connects to.
import type { AppInstance } from './runtime';
import { assertPublicHost, fetchPublic, UnsafeUrlError, type PublicFetchInit } from './urlGuard';

// CDNs chain a hop or two (a load balancer, a regional edge). More than this
// is a loop or something stranger.
const MAX_REDIRECTS = 5;

/** What callers may ask of an app fetch: a method, a Range header, cancellation. */
export type AppFetchInit = PublicFetchInit;

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
	init: AppFetchInit = {}
): Promise<Response> {
	let current = url;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const response = await fetchPublic(current, init);
		const location = response.headers.get('location');
		if (response.status < 300 || response.status >= 400 || !location) return response;

		await response.body?.cancel();
		const next = new URL(location, current).toString();
		await assertAppUrl(app, next);
		current = next;
	}
	throw new UnsafeUrlError(`${app.manifest.id}: too many redirects`);
}

/**
 * Reads a response as text, refusing one larger than `maxBytes` so an app's
 * server can't make the host buffer an unbounded body.
 */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
	if (!response.body) return '';
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of response.body) {
		size += chunk.byteLength;
		if (size > maxBytes) {
			await response.body.cancel().catch(() => {});
			throw new UnsafeUrlError(`Response exceeds ${maxBytes} bytes`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}
