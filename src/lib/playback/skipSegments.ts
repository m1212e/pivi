// Decisions behind the TV player's skip banner, kept free of Svelte so
// skipController stays thin and this stays testable.

/** A skippable section an app reports for a session, like a sponsor segment. */
export type SkipSegment = { startSeconds: number; endSeconds: number; label: string };

// Lead time so the toggle is reachable before the segment starts.
const SKIP_LEAD_SECONDS = 3;
// A segment at the very start never has a lead window to enter.
const SKIP_IMMEDIATE_START_SECONDS = 1;

/** Everything nextSkipStep needs, passed in so it doesn't read Svelte state. */
export type SkipInput = {
	segments: readonly SkipSegment[];
	decided: ReadonlySet<SkipSegment>;
	active: SkipSegment | null;
	position: number;
	playing: boolean;
	buffering: boolean;
};

/** `resolve` means the segment was reached, `show` sets what the banner offers. */
export type SkipStep =
	{ kind: 'resolve'; segment: SkipSegment } | { kind: 'show'; segment: SkipSegment | null };

function atVideoStart(input: SkipInput): SkipSegment | undefined {
	return input.segments.find(
		(s) =>
			!input.decided.has(s) &&
			s.startSeconds <= SKIP_IMMEDIATE_START_SECONDS &&
			input.position >= s.startSeconds &&
			input.position < s.endSeconds
	);
}

function inLeadWindow(input: SkipInput): SkipSegment | undefined {
	return input.segments.find(
		(s) =>
			!input.decided.has(s) &&
			input.position >= s.startSeconds - SKIP_LEAD_SECONDS &&
			input.position < s.startSeconds
	);
}

/**
 * Picks the skip banner's next move. Driven only by position, so pausing in a
 * lead window freezes the decision instead of firing on a timer.
 */
export function nextSkipStep(input: SkipInput): SkipStep {
	if (input.active) {
		return input.position >= input.active.startSeconds
			? { kind: 'resolve', segment: input.active }
			: { kind: 'show', segment: input.active };
	}
	// `play` fires before data loads, a seek then would be a no-op that still marks it decided.
	const first = input.playing && !input.buffering ? atVideoStart(input) : undefined;
	if (first) return { kind: 'resolve', segment: first };
	return { kind: 'show', segment: inLeadWindow(input) ?? null };
}

/** Applies the viewer's skip toggle once a segment is reached. Null means play through. */
export function skipTarget(
	segment: SkipSegment,
	skipEnabled: boolean,
	playing: boolean
): number | null {
	// A paused viewer scrubbing through one should not be yanked forward.
	return skipEnabled && playing ? segment.endSeconds : null;
}
