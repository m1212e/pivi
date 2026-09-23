// The generic playback proxy: any plugin's resolved stream (see
// #lib/plugins/host's resolveStreamRequest) ends up here, remuxed live by
// ffmpeg into something a plain <video> tag can play. Nothing below is
// specific to any one plugin -- it only ever touches the generic
// ResolvedStream shape, so a second plugin needing playback is just another
// entry in src/api/plugins/manager.ts's registry, not a second version of
// this route.
//
// Seeking is "restart the pipeline at a new timestamp" (`?t=`, passed to
// ffmpeg as -ss before each -i) rather than true byte-range serving on this
// endpoint -- ffmpeg's -ss still fast-seeks the underlying CDN source via
// HTTP range under the hood, it just means a scrub reopens the stream from
// scratch instead of seeking within one continuous connection.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { error, redirect } from '@sveltejs/kit';
import { getPlugin } from '#api/plugins/manager';
import { resolveStreamCached } from '#api/plugins/streamCache';
import type { RequestHandler } from './$types';

async function resolvePlaybackSource(pluginId: string, sessionId: string, maxHeight?: number) {
	try {
		const plugin = await getPlugin(pluginId);
		return await resolveStreamCached(pluginId, sessionId, plugin, maxHeight);
	} catch (err) {
		error(404, err instanceof Error ? err.message : 'Could not resolve stream');
	}
}

// VP9/AV1 (common for anything above 1080p) can't go in an MP4 container
// without re-encoding -- WebM (Matroska) natively supports them instead.
// Everything else (typically H.264+AAC) goes in MP4, the broader-
// compatibility default.
function containerFor(vcodec: string): 'webm' | 'mp4' {
	return /^(vp0?9|av0?1)/.test(vcodec) ? 'webm' : 'mp4';
}

function buildFfmpegArgs(
	videoUrl: string,
	audioUrl: string | undefined,
	seekSeconds: number,
	container: 'webm' | 'mp4'
): string[] {
	return [
		'-ss',
		String(seekSeconds),
		'-i',
		videoUrl,
		...(audioUrl ? ['-ss', String(seekSeconds), '-i', audioUrl] : []),
		'-map',
		'0:v:0',
		'-map',
		audioUrl ? '1:a:0' : '0:a:0',
		'-c',
		'copy',
		// The video and audio tracks are fetched as two independent network
		// streams that don't necessarily arrive at the same rate -- without
		// slack here ffmpeg can abort with "too many packets buffered" well
		// before the slower of the two catches up.
		'-max_muxing_queue_size',
		'4096',
		'-f',
		container,
		// Fragmented, no seekable moov atom to write up front -- required for
		// a container we're streaming out as it's produced rather than
		// writing to a seekable file. `faststart` doesn't apply to a live
		// pipe (there's no final file to rewrite the moov atom into) and just
		// adds buffering delay, so it's deliberately left out.
		...(container === 'mp4' ? ['-movflags', 'frag_keyframe+empty_moov+default_base_moof'] : []),
		'pipe:1'
	];
}

// Holds back the first couple of megabytes (roughly a few seconds at typical
// bitrates) before sending anything at all, instead of relaying every byte to
// the client the instant ffmpeg produces it -- that head start gives the
// client's own buffer some real margin to absorb a transient hiccup (network
// jitter fetching from the CDN, an uneven pace between the video/audio
// fetches) instead of it hitting playback immediately, which is what made
// this path choppy in the first place. Backpressure-aware throughout:
// ffmpeg's stdout is paused whenever the stream's own queue is already full
// (past `prebufferBytes`) and resumed via `pull()` once the client actually
// asks for more, rather than buffering an ever-growing queue in memory if the
// client reads slower than ffmpeg produces.
function createPrebufferedStream(
	ffmpeg: ChildProcessByStdio<null, Readable, null>,
	prebufferBytes: number,
	killFfmpeg: () => void
) {
	return new ReadableStream(
		{
			start(controller) {
				let prebuffer: Buffer[] = [];
				let prebufferedBytes = 0;
				let prebuffering = true;

				function enqueue(chunk: Buffer) {
					try {
						controller.enqueue(chunk);
					} catch {
						// Controller already closed/errored (client gone) -- nothing
						// left to enqueue into, just stop feeding it.
						killFfmpeg();
						return;
					}
					if ((controller.desiredSize ?? 0) <= 0) ffmpeg.stdout.pause();
				}

				function flushPrebuffer() {
					prebuffering = false;
					for (const chunk of prebuffer) enqueue(chunk);
					prebuffer = [];
				}

				ffmpeg.stdout.on('data', (chunk: Buffer) => {
					if (prebuffering) {
						prebuffer.push(chunk);
						prebufferedBytes += chunk.length;
						if (prebufferedBytes >= prebufferBytes) flushPrebuffer();
						return;
					}
					enqueue(chunk);
				});
				ffmpeg.stdout.on('end', () => {
					if (prebuffering) flushPrebuffer();
					try {
						controller.close();
					} catch {
						// Already closed via cancel() below.
					}
				});
				ffmpeg.stdout.on('error', (err) => controller.error(err));
			},
			// The client's own read loop drained enough of the queue to want
			// more -- resume ffmpeg's stdout if a previous enqueue() paused it.
			pull() {
				ffmpeg.stdout.resume();
			},
			cancel: killFfmpeg
		},
		new ByteLengthQueuingStrategy({ highWaterMark: prebufferBytes })
	);
}

// A cap on requested video height (see plugins/youtube/stream.ts) -- always
// resolving the true "best" available stream, sometimes 4K/8K, gives ffmpeg
// far more bitrate to remux and forward in real time than a live pipe can
// actually sustain, which is what made playback choppy.
function parseMaxHeight(url: URL): number | undefined {
	return Number(url.searchParams.get('quality')) || undefined;
}

function parseSeekSeconds(url: URL): number {
	return Number(url.searchParams.get('t') ?? 0);
}

function contentTypeFor(container: 'webm' | 'mp4'): string {
	return container === 'mp4' ? 'video/mp4' : 'video/webm';
}

export const GET: RequestHandler = async ({ params, url, request }) => {
	const { pluginId, sessionId } = params;
	const maxHeight = parseMaxHeight(url);
	const { videoUrl, audioUrl, vcodec } = await resolvePlaybackSource(
		pluginId,
		sessionId,
		maxHeight
	);

	const seekSeconds = parseSeekSeconds(url);

	// `audioUrl` absent means whatever resolved this session already handed
	// back one self-contained, directly playable URL -- true of any plugin,
	// not just this one (see #lib/plugins/host's ResolvedStream). There's
	// nothing to remux in that case, so on the very first request (seeking
	// past 0 needs the ffmpeg path below -- a plain redirect can't apply a
	// time offset) just point the browser straight at it: one real network
	// hop and no live transcoding process at all, instead of our server
	// opening its own connection, spawning ffmpeg, and relaying every byte
	// through a second hop. This is the single biggest win against "why is
	// the real YouTube app so much faster to start" -- most of that gap is
	// exactly this extra hop-and-transcode round trip.
	if (!audioUrl && seekSeconds === 0) redirect(302, videoUrl);

	const container = containerFor(vcodec);
	const args = buildFfmpegArgs(videoUrl, audioUrl, seekSeconds, container);
	const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] });

	// Both belt and suspenders: `request.signal` fires when the incoming
	// request itself is aborted, but a <video> element abandoning a response
	// mid-stream (navigating away, changing its `src`, or just being
	// destroyed) is the *response* stream's consumer going away -- that's
	// reported through the ReadableStream's own `cancel()`, not the request
	// signal, and without this ffmpeg (and the network fetches feeding it)
	// kept running indefinitely after nobody was watching anymore.
	let killed = false;
	function killFfmpeg() {
		if (killed) return;
		killed = true;
		ffmpeg.kill();
	}
	request.signal.addEventListener('abort', killFfmpeg);

	const PREBUFFER_BYTES = 2 * 1024 * 1024;
	const stream = createPrebufferedStream(ffmpeg, PREBUFFER_BYTES, killFfmpeg);

	return new Response(stream, {
		headers: { 'Content-Type': contentTypeFor(container) }
	});
};
