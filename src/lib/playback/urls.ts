// Raw stream URLs never reach the client, these point at the host's proxy routes.
import type { Container, QualityOption } from './quality';

export type TrackKind = 'video' | 'audio';

export function createSessionUrls(appId: string, sessionId: string) {
	const app = encodeURIComponent(appId);
	const session = encodeURIComponent(sessionId);
	const trackBase = `/api/stream-track/${app}/${session}`;

	return {
		stream: (seconds: number, quality: QualityOption) =>
			`/api/stream/${app}/${session}?${new URLSearchParams({ t: String(seconds), quality: String(quality) })}`,
		track: (track: TrackKind, quality: QualityOption) =>
			`${trackBase}/${track}?${new URLSearchParams({ quality: String(quality) })}`,
		trackIndex: (track: TrackKind, container: Container, quality: QualityOption) =>
			`${trackBase}/${track}/index?${new URLSearchParams({ container, quality: String(quality) })}`,
		subtitle: (language: string) =>
			`/api/stream-subtitle/${app}/${session}/${encodeURIComponent(language)}`
	};
}

// Container comes from the resolved stream, guessing from the codec gets vp9 and av1 wrong.
export function mimeTypeFor(container: Container, kind: TrackKind): string {
	return `${kind}/${container}`;
}

/** Where the next entry of a sequence plays. Callers replace history with it. */
export function nextSessionHref(appId: string, nextSessionId: string, context: string): string {
	const params = new URLSearchParams({ context });
	return `/play/${encodeURIComponent(appId)}/${encodeURIComponent(nextSessionId)}?${params}`;
}
