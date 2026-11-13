// An app's declared domains say *where* it may send the host, but a name can
// still point somewhere it shouldn't: a public-looking hostname whose DNS answer
// is 127.0.0.1, 192.168.x.x or a cloud metadata address would turn "fetch this
// stream for me" into a request to the LAN or the host's own services. Before
// the host (ffmpeg, the stream proxy) fetches an app-supplied URL, its host
// has to resolve to public addresses only.
//
// fetchPublic does the checking in its own DNS lookup, so the address that was
// checked is the one it connects to and a name that changes its answer between
// a check and the fetch (DNS rebinding) gains nothing.
import { lookup as lookupCallback, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

// Loopback, private, link-local, CGNAT, documentation and multicast ranges.
const nonPublic = new BlockList();
for (const [network, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const) {
	nonPublic.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
	['::', 128],
	['::1', 128],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8],
	['2001:db8::', 32]
] as const) {
	nonPublic.addSubnet(network, prefix, 'ipv6');
}

// An IPv4 address written into an IPv6 one (::ffff:10.0.0.1, or the NAT64 form)
// is judged as the IPv4 address it carries.
function embeddedIpv4(address: string): string | undefined {
	const match = address.toLowerCase().match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
	return match?.[1];
}

/**
 * The per-address check behind assertPublicHost, exported for its tests.
 * Non-IP input returns false, so it fails closed.
 */
export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return false;
	const embedded = family === 6 ? embeddedIpv4(address) : undefined;
	if (embedded) return isPublicAddress(embedded);
	return !nonPublic.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Thrown by streamCache.ts when an app hands back a URL the host must not fetch. */
export class UnsafeUrlError extends Error {}

/**
 * Called by streamCache.ts on every stream url before ffmpeg or the proxy
 * fetch it. Every resolved address must be public, since a name can return a mix.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
	const host = hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
		throw new UnsafeUrlError(`${hostname} does not resolve to a public address`);
	}
}

// Hands the socket only addresses that passed the check. Node may ask for one
// address or, to race address families, for all of them.
const publicLookup: LookupFunction = (hostname, options, callback) => {
	lookupCallback(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
		if (err) return callback(err, '', 0);
		if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
			return callback(
				new UnsafeUrlError(`${hostname} does not resolve to a public address`),
				'',
				0
			);
		}
		if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses);
		callback(null, addresses[0].address, addresses[0].family);
	});
};

/** The only request options app fetches need, see fetchPublic. */
export type PublicFetchInit = {
	method?: 'GET' | 'HEAD';
	headers?: Record<string, string>;
	signal?: AbortSignal;
};

// Only until the response starts. A stalled body is the reader pausing
// (playback paused, ffmpeg waiting on the browser), not a dead server.
const RESPONSE_TIMEOUT_MS = 30_000;

// Statuses a Response refuses a body for.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function toHeaders(raw: http.IncomingHttpHeaders): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(raw)) {
		for (const item of [value ?? []].flat()) headers.append(key, item);
	}
	return headers;
}

/**
 * A single request that never follows redirects and refuses to connect to a
 * non-public address, checked at connect time rather than beforehand. Used by
 * appFetch.ts, which adds the per-hop domain checks on top.
 */
export function fetchPublic(rawUrl: string, init: PublicFetchInit = {}): Promise<Response> {
	const url = new URL(rawUrl);
	const host = url.hostname.replace(/^\[|\]$/g, '');
	// The socket skips the lookup for an IP literal, so it's checked here instead.
	if (isIP(host) && !isPublicAddress(host)) {
		return Promise.reject(new UnsafeUrlError(`${host} is not a public address`));
	}
	const client = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
	if (!client) return Promise.reject(new UnsafeUrlError(`Unsupported protocol ${url.protocol}`));

	const method = init.method ?? 'GET';
	return new Promise((resolve, reject) => {
		const request = client.request(
			url,
			{
				method,
				headers: init.headers,
				signal: init.signal,
				lookup: publicLookup,
				timeout: RESPONSE_TIMEOUT_MS
			},
			(response) => {
				request.setTimeout(0);
				const status = response.statusCode ?? 502;
				const empty = method === 'HEAD' || NULL_BODY_STATUSES.has(status);
				if (empty) response.resume();
				try {
					resolve(
						new Response(empty ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>), {
							status,
							statusText: response.statusMessage,
							headers: toHeaders(response.headers)
						})
					);
				} catch (error) {
					response.destroy();
					reject(error);
				}
			}
		);
		request.on('timeout', () => request.destroy(new Error(`${url.host} did not respond`)));
		request.on('error', reject);
		request.end();
	});
}
