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

const fail = (message: string): ProbeLine => ({ level: 'fail', message });
const ok = (message: string): ProbeLine => ({ level: 'ok', message });

/** Every URL in the answer has to be https and on a declared domain. */
function checkUrls(manifest: AppManifest, stream: ResolvedStream): ProbeLine[] {
	const urls: [string, string][] = [['videoUrl', stream.videoUrl]];
	if (stream.audioUrl) urls.push(['audioUrl', stream.audioUrl]);
	for (const track of stream.subtitleTracks ?? [])
		urls.push([`subtitle ${track.language}`, track.url]);
	return urls.map(([label, url]) => {
		const problem = allowed(manifest, url);
		return problem ? fail(`${label}: ${problem}`) : ok(`${label}: https, domain allowed`);
	});
}

/** The URIs a playlist references, variants, segments and keys alike, made absolute. */
function playlistRefs(text: string, base: URL): string[] {
	const refs = [...text.matchAll(/^(?!#)(\S+)$/gm), ...text.matchAll(/URI="([^"]+)"/g)].map(
		(m) => m[1]!
	);
	return [...new Set(refs.slice(0, 50).map((ref) => new URL(ref, base).toString()))];
}

/** The host proxies an HLS playlist and everything it references, so all of it must be allowed. */
async function probeHls(
	manifest: AppManifest,
	url: string,
	signal: AbortSignal
): Promise<ProbeLine[]> {
	try {
		const base = new URL(url);
		const response = await fetch(base, { signal });
		const text = await response.text();
		if (!response.ok || !text.startsWith('#EXTM3U')) {
			return [fail(`videoUrl is not an HLS playlist (HTTP ${response.status})`)];
		}
		const refs = playlistRefs(text, base);
		const blocked = refs
			.map((u) => [u, allowed(manifest, u)] as const)
			.find(([, problem]) => problem);
		const lines = [
			blocked
				? fail(`playlist references blocked URLs, e.g. ${blocked[0]} (${blocked[1]})`)
				: ok(`playlist ok, ${refs.length} references on allowed domains`)
		];
		if (!/#EXT-X-STREAM-INF|#EXTINF/.test(text)) {
			lines.push({ level: 'warn', message: 'playlist has neither variants nor segments' });
		}
		return lines;
	} catch (error) {
		return [fail(`could not fetch the playlist: ${String(error)}`)];
	}
}

const INDEX_MARKERS = {
	webm: { name: 'Cues', bytes: [0x1c, 0x53, 0xbb, 0x6b] },
	mp4: { name: 'sidx', bytes: [0x73, 0x69, 0x64, 0x78] }
};

/**
 * Fetches the start of one file. Separate video and audio tracks go through MSE, which needs the
 * segment index up front, so for those it also looks for it.
 */
async function probeFile(
	label: string,
	url: string,
	container: string,
	separateTracks: boolean,
	signal: AbortSignal
): Promise<ProbeLine[]> {
	try {
		const { response, bytes } = await head(url, signal);
		if (!response.ok && response.status !== 206) return [fail(`${label}: HTTP ${response.status}`)];
		const lines = [
			ok(
				`${label}: HTTP ${response.status}, ${response.headers.get('content-type') ?? 'no content type'}`
			)
		];
		if (separateTracks) {
			const marker = container === 'webm' ? INDEX_MARKERS.webm : INDEX_MARKERS.mp4;
			lines.push(
				includes(bytes, marker.bytes)
					? ok(`${label}: segment index (${marker.name}) within the first 2 MiB`)
					: fail(
							`${label}: no ${marker.name} within the first 2 MiB, the player cannot seek separate tracks`
						)
			);
		}
		return lines;
	} catch (error) {
		return [fail(`${label}: could not fetch: ${String(error)}`)];
	}
}

export async function probeStream(
	manifest: AppManifest,
	stream: ResolvedStream
): Promise<ProbeLine[]> {
	const signal = AbortSignal.timeout(15_000);
	const lines = checkUrls(manifest, stream);
	if (stream.videoContainer === 'hls')
		return [...lines, ...(await probeHls(manifest, stream.videoUrl, signal))];

	const separate = Boolean(stream.audioUrl);
	lines.push(
		...(await probeFile('videoUrl', stream.videoUrl, stream.videoContainer, separate, signal))
	);
	if (stream.audioUrl) {
		lines.push(
			...(await probeFile(
				'audioUrl',
				stream.audioUrl,
				stream.audioContainer ?? 'mp4',
				true,
				signal
			))
		);
	}
	return lines;
}
