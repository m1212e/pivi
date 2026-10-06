/** The TV player and the phone remote both show times, so they share one format. Bad input reads as 0:00 instead of NaN. */
export function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const minutes = Math.floor(seconds / 60);
	const rest = Math.floor(seconds % 60);
	return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

// Structural so tests and callers don't need a real TimeRanges.
type Ranges = { length: number; start(i: number): number; end(i: number): number };

/** Buffer health for the diagnostics panel. 0 when the playhead sits outside every range. */
export function bufferedAheadSeconds(buffered: Ranges, currentTime: number): number {
	for (let i = 0; i < buffered.length; i++) {
		if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i)) {
			return buffered.end(i) - currentTime;
		}
	}
	return 0;
}
