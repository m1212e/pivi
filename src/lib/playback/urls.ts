// Raw stream URLs never reach the client, these point at the host's proxy routes.
import type { Container, QualityOption } from './quality';

/** The two separate streams MSE plays side by side. */
export type TrackKind = 'video' | 'audio';
/** Handed to the engine, quality catalog and index probe so they all hit the same session. */
export type SessionUrls = ReturnType<typeof createSessionUrls>;

/** One factory so every URL for a session is built with the same encoding. */
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

/** MIME types for the MSE manifest. Uses the resolved container since guessing from the codec gets vp9 and av1 wrong. */
export function mimeTypeFor(container: Container, kind: TrackKind): string {
	return `${kind}/${container}`;
}

/** Lets the player continue into the next entry of a sequence. Callers replace history with it. */
export function nextSessionHref(appId: string, nextSessionId: string, context: string): string {
	const params = new URLSearchParams({ context });
	return `/play/${encodeURIComponent(appId)}/${encodeURIComponent(nextSessionId)}?${params}`;
}
