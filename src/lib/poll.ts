/**
 * Keeps TV screens in sync with server state that has no push channel, like
 * the expiring pairing QR token and the network status. Shared so every poller
 * skips overlapping reads and keeps the last value when a read fails.
 * Returns the stop function, usable directly as an $effect or onMount cleanup.
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
			// A transient server or network hiccup shouldn't blank the UI
		} finally {
			inFlight = false;
		}
	}, intervalMs);
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
