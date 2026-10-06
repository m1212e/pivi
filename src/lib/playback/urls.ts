// Raw stream URLs never reach the client, these point at the host's proxy routes.
import type { Container, QualityOption } from './quality';
import { playHref } from '../routes';

/** The two separate streams MSE plays side by side. */
export type TrackKind = 'video' | 'audio';
/** Handed to the engine, quality catalog and index probe so they all hit the same session. */
export type SessionUrls = ReturnType<typeof createSessionUrls>;

/** One factory so every URL for a session is built with the same encoding. */
export function createSessionUrls(appId: string, sessionId: string) {
	const app = encodeURIComponent(appId);
	const session = encodeURIComponent(sessionId);
	const trackBase = `/api/stream-track/${app}/${session}`;
	// An app without quality tiers gets no cap at all.
	const qualityParam = (quality: QualityOption | undefined): Record<string, string> =>
		quality === undefined ? {} : { quality: String(quality) };

	return {
		stream: (seconds: number, quality: QualityOption | undefined) =>
			`/api/stream/${app}/${session}?${new URLSearchParams({ t: String(seconds), ...qualityParam(quality) })}`,
		track: (track: TrackKind, quality: QualityOption | undefined) => {
			const query = new URLSearchParams(qualityParam(quality)).toString();
			return `${trackBase}/${track}${query && `?${query}`}`;
		},
		trackIndex: (track: TrackKind, container: Container, quality: QualityOption | undefined) =>
			`${trackBase}/${track}/index?${new URLSearchParams({ container, ...qualityParam(quality) })}`,
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
	return playHref(appId, nextSessionId, context);
}
