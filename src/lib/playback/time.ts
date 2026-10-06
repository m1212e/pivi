export function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const minutes = Math.floor(seconds / 60);
	const rest = Math.floor(seconds % 60);
	return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

type Ranges = { length: number; start(i: number): number; end(i: number): number };

/** Seconds buffered past the playhead, 0 when it sits outside every range. */
export function bufferedAheadSeconds(buffered: Ranges, currentTime: number): number {
	for (let i = 0; i < buffered.length; i++) {
		if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i)) {
			return buffered.end(i) - currentTime;
		}
	}
	return 0;
}
