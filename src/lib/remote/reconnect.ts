// Short first retry so a brief drop (phone sleep, wifi blip) recovers quickly.
// The cap keeps a long outage from hammering the relay.
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

/** Exponential backoff for createReconnector, exported so the schedule can be tested on its own. */
export function reconnectDelayMs(attempt: number): number {
	return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
}

/**
 * Keeps the TV kiosk's relay socket (RemoteBridge.svelte) coming back after
 * drops without hammering the relay. Call `connected()` once up, `lost()` on
 * drop or failed open, and `stop()` on teardown.
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
