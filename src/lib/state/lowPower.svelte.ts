import { browser } from '$app/env';
import { browserStorage, readItem, writeItem } from '#lib/storage';

// Per TV browser, like the music toggle. Until it's flipped once, it follows
// what the server detected for this board (see api/lowPower.ts).
const KEY = 'pivi.lowPower';
const storage = browserStorage(browser);
const stored = readItem(storage, KEY);

/** Read by the root layout to set `data-perf` on the page, flipped from the home page. */
export const lowPower = $state({
	enabled: stored ? stored === 'on' : browser && document.documentElement.dataset.perf === 'low'
});

/** The home page's low power toggle. Persists so the choice sticks for this TV. */
export function toggleLowPower() {
	lowPower.enabled = !lowPower.enabled;
	writeItem(storage, KEY, lowPower.enabled ? 'on' : 'off');
}

/** Turns low power on for this session only, unless someone already picked a setting on this TV. */
export function suggestLowPower() {
	if (stored === null) lowPower.enabled = true;
}
