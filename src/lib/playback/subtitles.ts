// Narrower than the app-facing SubtitleTrack on purpose. Url and format never reach the client.
export type SubtitleTrack = {
	language: string;
	label: string | null;
	kind: 'caption' | 'transcription';
};

// The GraphQL layer has no literal union type, so `kind` arrives as a plain string.
export function toSubtitleTracks(
	tracks: readonly { language: string; label: string | null; kind: string }[] | null | undefined
): SubtitleTrack[] {
	return (tracks ?? []).map((t) => ({
		language: t.language,
		label: t.label,
		kind: t.kind as SubtitleTrack['kind']
	}));
}

/** Off (null) always comes first. */
export function subtitleOptions(tracks: readonly SubtitleTrack[]): (string | null)[] {
	return [null, ...tracks.map((t) => t.language)];
}
