/**
 * Calls `read` every `intervalMs` and hands the result to `onValue`.
 * A failed read keeps the last value and retries on the next tick, and a
 * slow read is never overlapped by the next one. Returns the stop function,
 * which makes it directly usable as an $effect or onMount cleanup.
 */
export function pollEvery<T>(
	intervalMs: number,
	read: () => Promise<T>,
	onValue: (value: T) => void
): () => void {
	let stopped = false;
	let inFlight = false;
	const timer = setInterval(async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			const value = await read();
			if (!stopped) onValue(value);
		} catch {
			// transient server or network hiccup
		} finally {
			inFlight = false;
		}
	}, intervalMs);
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
