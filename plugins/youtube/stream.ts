// Resolves a video id to a directly playable stream via yt-dlp — the
// extraction tool SKETCH.md's "YouTube" decision already commits to,
// reused here through yt-dlp-wrap (a thin wrapper spawning the actual
// yt-dlp binary) rather than a pure-JS re-implementation of YouTube's
// extraction logic, which is exactly the kind of native tool the "Reuse
// strategy for plugins" decision calls for.
//
// yt-dlp-wrap doesn't ship the binary itself, only expects one already on
// PATH — rather than making that a manual install step, this downloads it
// once (yt-dlp-wrap's own downloadFromGithub helper) into a local cache and
// reuses it from there on every subsequent call.
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import YTDlpWrap from 'yt-dlp-wrap';
import type { ResolvedStream } from '#lib/plugins/host';

const BINARY_PATH = fileURLToPath(
	new URL(`../../.cache/yt-dlp${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url)
);

let ytDlp: Promise<YTDlpWrap> | undefined;

function getYtDlp(): Promise<YTDlpWrap> {
	if (!ytDlp) {
		ytDlp = (async () => {
			if (!existsSync(BINARY_PATH)) {
				await mkdir(new URL('../../.cache/', import.meta.url), { recursive: true });
				await YTDlpWrap.downloadFromGithub(BINARY_PATH);
			}
			return new YTDlpWrap(BINARY_PATH);
		})();
	}
	return ytDlp;
}

// A subset of yt-dlp's own `-j` (dump single JSON) output — only the fields
// this actually reads. `requested_formats` is present when yt-dlp picked a
// separate video-only + audio-only pair (the common case for anything above
// 360p); otherwise the format it picked already has both, and its own
// vcodec/acodec/url describe it directly.
type YtDlpFormat = { url: string; vcodec?: string; acodec?: string; ext: string };
type YtDlpInfo = {
	title: string;
	duration: number;
	url?: string;
	vcodec?: string;
	acodec?: string;
	ext?: string;
	requested_formats?: YtDlpFormat[];
};

// yt-dlp's own reported extension is the only reliable source for this --
// see host.ts's Container type comment for why the codec string can't be
// trusted (vp9 shows up in both containers; av1 shows up as mp4 despite
// webm supporting it). `m4a` is yt-dlp's extension for an audio-only mp4.
function containerFrom(ext: string): 'mp4' | 'webm' {
	if (ext === 'webm') return 'webm';
	if (ext === 'mp4' || ext === 'm4a') return 'mp4';
	throw new Error(`Unsupported container "${ext}" for MSE/remux playback`);
}

// `-f best` (a single combined-audio+video file) hits YouTube's own
// deprecation of most pre-merged formats head-on — nearly every video now
// only offers separate video-only and audio-only streams. Requesting
// bestvideo+bestaudio keeps real quality (VP9/AV1 up to 4K where available);
// the host remuxes the two streams together (see
// src/routes/api/stream/[pluginId]/[sessionId]) rather than requiring a
// single pre-muxed URL.
//
// `maxHeight` caps that -- always resolving the true best (sometimes 4K/8K,
// far more bitrate than a live remux-and-forward can keep up with in real
// time) is what made playback choppy in practice, so the caller can ask for
// something the network/CPU can actually sustain.
//
// When a cap is given, this tries an *exact*-height pre-muxed format first
// (`best[height=X]`) -- YouTube still serves one for a handful of common
// resolutions (360p/720p) with no separate audio track to remux, which the
// host can then hand the browser directly instead of proxying through
// ffmpeg (see the streaming route's own comment on why that's much faster
// to start). This never trades away quality to get there: it only ever
// matches the exact resolution the caller asked for, falling straight back
// to real adaptive streams at that same cap otherwise -- unlike a `<=`
// filter here, which could silently hand back a much lower muxed format
// just because one happened to exist under the cap.
function formatSelector(maxHeight: number | undefined): string {
	if (!maxHeight) return 'bestvideo+bestaudio/best';
	return `best[height=${maxHeight}]/bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`;
}

function extractTracks(videoId: string, info: YtDlpInfo) {
	const [video, audio] = info.requested_formats ?? [
		{ url: info.url!, vcodec: info.vcodec, acodec: info.acodec, ext: info.ext! }
	];
	if (!video?.url) throw new Error(`yt-dlp returned no stream URL for ${videoId}`);
	return { video, audio };
}

export async function resolveStream(videoId: string, maxHeight?: number): Promise<ResolvedStream> {
	const wrap = await getYtDlp();
	const output = await wrap.execPromise([
		`https://www.youtube.com/watch?v=${videoId}`,
		'-f',
		formatSelector(maxHeight),
		'-j',
		// Without a JS runtime + the challenge-solver component, yt-dlp can't
		// decode YouTube's current signature cipher/"n" challenge and silently
		// hands back URLs that look fine but 403 on the CDN -- bun's already a
		// hard dependency of this whole project, so it doubles as the runtime
		// here instead of requiring a separate deno install. `ejs:github`
		// fetches the actual solver script once and caches it locally (not a
		// per-request round trip).
		'--js-runtimes',
		'bun',
		'--remote-components',
		'ejs:github'
	]);
	const info = JSON.parse(output.trim()) as YtDlpInfo;
	const { video, audio } = extractTracks(videoId, info);

	return {
		videoUrl: video.url,
		audioUrl: audio?.url,
		vcodec: video.vcodec ?? 'unknown',
		acodec: (audio ?? video).acodec,
		videoContainer: containerFrom(video.ext),
		audioContainer: audio ? containerFrom(audio.ext) : undefined,
		title: info.title,
		duration: info.duration
	};
}
