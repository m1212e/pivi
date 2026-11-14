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
import ipaddr from 'ipaddr.js';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

// An address is public only when ipaddr.js classes it as plain unicast. That
// leaves out loopback, private, link-local, CGNAT, documentation, benchmarking,
// multicast, reserved, 6to4, Teredo and the other special-purpose ranges.
function isPublicParsed(parsed: ipaddr.IPv4 | ipaddr.IPv6): boolean {
	if (parsed.kind() === 'ipv6') {
		const v6 = parsed as ipaddr.IPv6;
		// NAT64 (64:ff9b::/96) carries an IPv4 address, which is what decides it.
		if (v6.range() === 'rfc6052') {
			const [, , , , , , high, low] = v6.parts;
			return isPublicParsed(
				ipaddr.IPv4.parse(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
			);
		}
	}
	return parsed.range() === 'unicast';
}

/**
 * The per-address check behind assertPublicHost, exported for its tests.
 * Non-IP input returns false, so it fails closed.
 */
export function isPublicAddress(address: string): boolean {
	if (isIP(address) === 0) return false;
	try {
		// `process` turns an IPv4-mapped IPv6 address into the IPv4 it carries.
		return isPublicParsed(ipaddr.process(address));
	} catch {
		return false;
	}
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
