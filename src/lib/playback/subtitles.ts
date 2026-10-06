/** Tracks the TV picker and the phone list. Narrower than the app facing SubtitleTrack on purpose, url and format never reach the client. */
export type SubtitleTrack = {
	language: string;
	label: string | null;
	kind: 'caption' | 'transcription';
};

/** Converts the play page's GraphQL result. `kind` arrives as a plain string since GraphQL has no literal union type. */
export function toSubtitleTracks(
	tracks: readonly { language: string; label: string | null; kind: string }[] | null | undefined
): SubtitleTrack[] {
	return (tracks ?? []).map((t) => ({
		language: t.language,
		label: t.label,
		kind: t.kind as SubtitleTrack['kind']
	}));
}

/** Choices for the subtitle picker. Off (null) always comes first so it is the default slot. */
export function subtitleOptions(tracks: readonly SubtitleTrack[]): (string | null)[] {
	return [null, ...tracks.map((t) => t.language)];
}
