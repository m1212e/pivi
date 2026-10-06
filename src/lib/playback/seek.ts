// A seek lands late and an ffmpeg reopen restarts the element clock, so raw time updates lie.

export type SeekTarget = { seconds: number; issuedAt: number } | null;

const SEEK_LANDED_SECONDS = 1.5;
// A seek that never lands (past the real end) stops being trusted after this.
const SEEK_GIVE_UP_MS = 8000;

export function clampSeek(seconds: number, duration: number): number {
	return Math.max(0, Math.min(duration, seconds));
}

/**
 * Decides whether a time update from the element should move the shown
 * position. `offset` is where the current ffmpeg request started.
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
