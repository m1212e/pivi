// Resolves a video id to a directly playable stream URL via yt-dlp — the
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

export type ResolvedStream = { videoUrl: string; audioUrl?: string };

// `-f best` (a single combined-audio+video file) hits YouTube's own
// deprecation of most pre-merged formats head-on — nearly every video now
// only offers separate video-only and audio-only streams. Requesting
// bestvideo+bestaudio and letting `-g` print both URLs (confirmed by hand:
// two lines back for a modern upload) instead of forcing a muxed format
// keeps real quality, at the cost of the player needing to open both
// (see src/api/plugins/runtime.ts's playMedia, which passes the second as
// mpv's --audio-file).
export async function resolveStream(videoId: string): Promise<ResolvedStream> {
	const wrap = await getYtDlp();
	const output = await wrap.execPromise([
		`https://www.youtube.com/watch?v=${videoId}`,
		'-f',
		'bestvideo+bestaudio/best',
		'-g'
	]);
	const [videoUrl, audioUrl] = output
		.trim()
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (!videoUrl) throw new Error(`yt-dlp returned no stream URL for ${videoId}`);
	return { videoUrl, audioUrl };
}
