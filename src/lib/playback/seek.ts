// A seek lands late and an ffmpeg reopen restarts the element clock, so raw time updates lie.

/** A seek the engine waits to land, null when none is pending. */
export type SeekTarget = { seconds: number; issuedAt: number } | null;

// A seek rarely lands exactly on the target, so allow some slack.
const SEEK_LANDED_SECONDS = 1.5;
// A seek that never lands (past the real end) stops being trusted after this.
const SEEK_GIVE_UP_MS = 8000;

/** How far the back and forward buttons, on the TV and the phone, jump. */
export const SEEK_STEP_SECONDS = 10;

/** Keeps scrubs, remote seeks and relative jumps inside the media. */
export function clampSeek(seconds: number, duration: number): number {
	return Math.max(0, Math.min(duration, seconds));
}

/**
 * Keeps the progress bar from jumping back after a scrub by holding stale time
 * updates until the seek lands. `offset` is where the current ffmpeg request started.
 */
export function settleTimeUpdate(
	target: SeekTarget,
	offset: number,
	elementTime: number,
	now: number
): { apply: boolean; target: SeekTarget } {
	if (!target) return { apply: true, target: null };
	const landed = Math.abs(offset + elementTime - target.seconds) <= SEEK_LANDED_SECONDS;
	const waiting = !landed && now - target.issuedAt < SEEK_GIVE_UP_MS;
	return waiting ? { apply: false, target } : { apply: true, target: null };
}
