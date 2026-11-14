// A `fetch` for talking to a remote registry: every hop (the request, the
// token realm it names, each redirect) connects only to public addresses,
// checked at connect time by fetchPublic. Without it a registry could aim the
// host at the LAN or at its own loopback services through the auth `realm` or a
// redirect. Redirects are followed by hand so each one is checked, and the
// Authorization header is dropped when one leaves the original host.
import { fetchPublic } from './urlGuard';

const MAX_REDIRECTS = 5;

export const publicFetch: typeof fetch = async (input, init) => {
	let url = new URL(input instanceof Request ? input.url : String(input));
	const headers = new Headers(init?.headers);
	const origin = url.origin;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const plain: Record<string, string> = {};
		headers.forEach((value, key) => (plain[key] = value));
		const response = await fetchPublic(url.href, {
			method: init?.method === 'HEAD' ? 'HEAD' : 'GET',
			headers: plain,
			signal: init?.signal ?? undefined
		});

		const location = response.headers.get('location');
		if (response.status < 300 || response.status >= 400 || !location) return response;
		await response.body?.cancel().catch(() => {});

		url = new URL(location, url);
		if (url.origin !== origin) headers.delete('authorization');
	}
	throw new Error('Too many redirects');
};
