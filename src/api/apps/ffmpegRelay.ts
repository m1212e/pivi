// ffmpeg can't be handed an app's URL directly: it would resolve the name and
// follow redirects on its own, past every check fetchAppUrl makes. So it reads
// from this loopback relay instead, which fetches through fetchAppUrl and only
// serves URLs registered for one ffmpeg run, under an unguessable path.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { fetchAppUrl } from './appFetch';
import type { AppInstance } from './runtime';

// What ffmpeg needs to seek and probe, nothing that would let it follow anywhere.
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

const sources = new Map<string, { app: AppInstance; url: string }>();
let port: Promise<number> | undefined;

async function relay(req: http.IncomingMessage, res: http.ServerResponse) {
	const source = sources.get((req.url ?? '').slice(1));
	if (!source || (req.method !== 'GET' && req.method !== 'HEAD')) {
		res.statusCode = 404;
		return void res.end();
	}

	const abort = new AbortController();
	res.on('close', () => abort.abort());
	try {
		const range = req.headers.range;
		const upstream = await fetchAppUrl(source.app, source.url, {
			method: req.method,
			headers: range ? { range } : {},
			signal: abort.signal
		});
		res.statusCode = upstream.status;
		for (const key of FORWARDED_HEADERS) {
			const value = upstream.headers.get(key);
			if (value) res.setHeader(key, value);
		}
		if (!upstream.body) return void res.end();
		await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream), res);
	} catch {
		// Upstream refused or the reader went away. Either way ffmpeg sees an error.
		if (res.headersSent) return void res.destroy();
		res.statusCode = 502;
		res.end();
	}
}

function listen(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => void relay(req, res));
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
		// Never the thing keeping the process alive on shutdown.
		server.unref();
	});
}

/**
 * The URL ffmpeg should read `url` from. Call `release` once ffmpeg exits, so
 * the path stops working.
 */
export async function relayForFfmpeg(
	app: AppInstance,
	url: string
): Promise<{ url: string; release: () => void }> {
	port ??= listen().catch((error) => {
		port = undefined;
		throw error;
	});
	const relayPort = await port;
	const token = randomBytes(24).toString('hex');
	sources.set(token, { app, url });
	return { url: `http://127.0.0.1:${relayPort}/${token}`, release: () => sources.delete(token) };
}
