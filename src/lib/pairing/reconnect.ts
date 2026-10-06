const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

/** Wait before reconnect attempt number `attempt` (0 based). Doubles up to a cap. */
export function reconnectDelayMs(attempt: number): number {
	return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
}

/**
 * Retries `connect` with backoff after each loss. Call `connected()` when a
 * connection is up and `lost()` when it drops or fails to open. `stop()`
 * ends it for good.
 */
export function createReconnector(connect: () => void) {
	let attempt = 0;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		connected() {
			attempt = 0;
		},
		lost() {
			if (stopped) return;
			clearTimeout(timer);
			timer = setTimeout(connect, reconnectDelayMs(attempt++));
		},
		stop() {
			stopped = true;
			clearTimeout(timer);
		}
	};
}
