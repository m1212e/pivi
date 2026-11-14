// HLS playlists reference further playlists and segments by URL, and the
// browser must never fetch an app's CDN directly (see the stream-hls route).
// So every playlist is rewritten on the way through: each URI it contains
// becomes a link back to the stream-hls route, carrying the absolute upstream
// URL and a signature. The signature means the route only ever fetches what
// a playlist it served pointed at, never a URL a page made up, on top of the
// usual per-app domain check every fetch gets anyway.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Per process: links only have to outlive one playback, and a restart
// reloads the player anyway.
const KEY = randomBytes(32);

function signatureFor(appId: string, sessionId: string, url: string): string {
	return createHmac('sha256', KEY)
		.update(`${appId}\n${sessionId}\n${url}`)
		.digest('base64url')
		.slice(0, 32);
}

/** True when `signature` was issued by `rewritePlaylist` for this session and URL. */
export function verifyHlsSignature(
	appId: string,
	sessionId: string,
	url: string,
	signature: string
): boolean {
	const expected = Buffer.from(signatureFor(appId, sessionId, url));
	const given = Buffer.from(signature);
	return expected.length === given.length && timingSafeEqual(expected, given);
}

// The route's file name only carries the upstream extension, which is what
// Shaka guesses a segment's format from when the playlist doesn't say.
function extensionOf(url: URL): string {
	const match = /\.([a-z0-9]{1,5})$/i.exec(url.pathname);
	return match ? match[1].toLowerCase() : 'bin';
}

/** Builds the proxied link for one upstream URI, relative to `base`. */
export type HlsLinkBuilder = (absoluteUrl: string) => string;

/** Links back into the stream-hls route for one session. */
export function hlsLinkBuilder(appId: string, sessionId: string): HlsLinkBuilder {
	const base = `/api/stream-hls/${encodeURIComponent(appId)}/${encodeURIComponent(sessionId)}`;
	return (absoluteUrl) => {
		const params = new URLSearchParams({
			u: absoluteUrl,
			s: signatureFor(appId, sessionId, absoluteUrl)
		});
		return `${base}/x.${extensionOf(new URL(absoluteUrl))}?${params}`;
	};
}

// Tags whose URI="..." attribute points at something the player fetches.
// Other tags can carry URLs too (Twitch puts ad tracking links in
// EXT-X-DATERANGE), but the player never fetches those, so they stay as is.
const URI_TAGS = new Set([
	'EXT-X-MAP',
	'EXT-X-KEY',
	'EXT-X-SESSION-KEY',
	'EXT-X-MEDIA',
	'EXT-X-I-FRAME-STREAM-INF',
	'EXT-X-PART',
	'EXT-X-PRELOAD-HINT',
	'EXT-X-RENDITION-REPORT',
	'EXT-X-SESSION-DATA'
]);

// Only http(s) is ever proxied. Anything else (data:, skd: key systems) can't
// be fetched by the host and is dropped from the line, so the player can't be
// pointed at it either.
function absolutize(uri: string, base: string): string | undefined {
	try {
		const url = new URL(uri, base);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
	} catch {
		return undefined;
	}
}

// One `KEY=value` attribute: the value is a quoted string (which may contain
// commas and `URI=`) or runs up to the next comma.
const ATTRIBUTE = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)(,|$)/y;

function rewriteTag(line: string, base: string, link: HlsLinkBuilder): string | undefined {
	const match = /^#([A-Z0-9-]+):/.exec(line);
	if (!match || !URI_TAGS.has(match[1])) return line;

	const head = match[0];
	const out: string[] = [];
	ATTRIBUTE.lastIndex = head.length;
	let pos = head.length;
	while (pos < line.length) {
		ATTRIBUTE.lastIndex = pos;
		const attr = ATTRIBUTE.exec(line);
		// Not parseable as an attribute list: don't guess, drop the line.
		if (!attr || attr[0].length === 0) return undefined;
		pos += attr[0].length;
		const [, key, value] = attr;
		if (key.toUpperCase() !== 'URI') {
			out.push(`${key}=${value}`);
			continue;
		}
		// Only a quoted URI is valid; anything else is not proxied.
		if (!value.startsWith('"')) return undefined;
		const absolute = absolutize(value.slice(1, -1), base);
		if (!absolute) return undefined;
		out.push(`URI="${link(absolute)}"`);
	}
	return head + out.join(',');
}

/**
 * Rewrites every URI in `playlist` (fetched from `base`) through `link`.
 * Lines whose URI can't be proxied are left out. Works for master and media
 * playlists alike, since both only reference things by URI lines and URI
 * attributes.
 */
export function rewritePlaylist(playlist: string, base: string, link: HlsLinkBuilder): string {
	const out: string[] = [];
	for (const raw of playlist.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith('#')) {
			const tag = rewriteTag(line, base, link);
			if (tag !== undefined) out.push(tag);
		} else if (line) {
			const absolute = absolutize(line, base);
			if (absolute) out.push(link(absolute));
		} else {
			out.push(line);
		}
	}
	return out.join('\n');
}

/** Whether a fetched resource is a playlist that needs rewriting, not a segment. */
export function isPlaylist(contentType: string | null, url: string): boolean {
	if (contentType && /mpegurl/i.test(contentType)) return true;
	return /\.m3u8?$/i.test(new URL(url).pathname);
}
