// Checks what an app's resolved stream will meet in the host: allowed domains,
// https, a reachable URL, and for separate tracks the segment index the host's
// MSE player needs. Probes from the developer's machine, so it shows what is
// wrong with the stream, not what the sandbox would allow.
import { domainsAllow, type AppManifest } from '@pivi/sdk/manifest';
import type { ResolvedStream } from '@pivi/sdk/protocol';

export type ProbeLine = { level: 'ok' | 'warn' | 'fail'; message: string };

const INDEX_WINDOW = 2 * 1024 * 1024;

function allowed(manifest: AppManifest, url: string): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return 'not a valid URL';
	}
	if (parsed.protocol !== 'https:') return 'not https, the host refuses it';
	if (!manifest.permissions.includes('network') || !manifest.network) {
		return 'the manifest has no network permission';
	}
	if (!domainsAllow(manifest.network.domains, parsed.hostname)) {
		return `${parsed.hostname} is not in network.domains`;
	}
	return undefined;
}

async function head(url: string, signal: AbortSignal) {
	const response = await fetch(url, { headers: { range: `bytes=0-${INDEX_WINDOW - 1}` }, signal });
	const bytes = new Uint8Array(await response.arrayBuffer());
	return { response, bytes };
}

const includes = (haystack: Uint8Array, needle: number[]) => {
	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
		return true;
	}
	return false;
};

export async function probeStream(
	manifest: AppManifest,
	stream: ResolvedStream
): Promise<ProbeLine[]> {
	const lines: ProbeLine[] = [];
	const signal = AbortSignal.timeout(15_000);
	const urls: [string, string][] = [['videoUrl', stream.videoUrl]];
	if (stream.audioUrl) urls.push(['audioUrl', stream.audioUrl]);
	for (const track of stream.subtitleTracks ?? [])
		urls.push([`subtitle ${track.language}`, track.url]);

	for (const [label, url] of urls) {
		const problem = allowed(manifest, url);
		lines.push(
			problem
				? { level: 'fail', message: `${label}: ${problem}` }
				: { level: 'ok', message: `${label}: https, domain allowed` }
		);
	}

	if (stream.videoContainer === 'hls') {
		try {
			const base = new URL(stream.videoUrl);
			const response = await fetch(base, { signal });
			const text = await response.text();
			if (!response.ok || !text.startsWith('#EXTM3U')) {
				lines.push({
					level: 'fail',
					message: `videoUrl is not an HLS playlist (HTTP ${response.status})`
				});
			} else {
				const refs = [...text.matchAll(/^(?!#)(\S+)$/gm), ...text.matchAll(/URI="([^"]+)"/g)].map(
					(m) => m[1]!
				);
				const hosts = new Set(refs.slice(0, 50).map((ref) => new URL(ref, base).toString()));
				const bad = [...hosts].map((u) => [u, allowed(manifest, u)] as const).filter(([, p]) => p);
				lines.push(
					bad.length
						? {
								level: 'fail',
								message: `playlist references blocked URLs, e.g. ${bad[0]![0]} (${bad[0]![1]})`
							}
						: { level: 'ok', message: `playlist ok, ${hosts.size} references on allowed domains` }
				);
				if (!/#EXT-X-STREAM-INF/.test(text) && !/#EXTINF/.test(text)) {
					lines.push({ level: 'warn', message: 'playlist has neither variants nor segments' });
				}
			}
		} catch (error) {
			lines.push({ level: 'fail', message: `could not fetch the playlist: ${String(error)}` });
		}
		return lines;
	}

	for (const [label, url, container] of [
		['videoUrl', stream.videoUrl, stream.videoContainer],
		...(stream.audioUrl ? [['audioUrl', stream.audioUrl, stream.audioContainer ?? 'mp4']] : [])
	] as [string, string, string][]) {
		try {
			const { response, bytes } = await head(url, signal);
			if (!response.ok && response.status !== 206) {
				lines.push({ level: 'fail', message: `${label}: HTTP ${response.status}` });
				continue;
			}
			lines.push({
				level: 'ok',
				message: `${label}: HTTP ${response.status}, ${response.headers.get('content-type') ?? 'no content type'}`
			});
			if (stream.audioUrl) {
				// Separate tracks are played through MSE, which needs the segment index up front.
				const hasIndex =
					container === 'webm'
						? includes(bytes, [0x1c, 0x53, 0xbb, 0x6b])
						: includes(bytes, [0x73, 0x69, 0x64, 0x78]);
				lines.push(
					hasIndex
						? {
								level: 'ok',
								message: `${label}: segment index (${container === 'webm' ? 'Cues' : 'sidx'}) within the first 2 MiB`
							}
						: {
								level: 'fail',
								message: `${label}: no ${container === 'webm' ? 'Cues' : 'sidx'} within the first 2 MiB, the player cannot seek separate tracks`
							}
				);
			}
		} catch (error) {
			lines.push({ level: 'fail', message: `${label}: could not fetch: ${String(error)}` });
		}
	}
	return lines;
}
