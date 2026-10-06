import { browser } from '$app/env';
import { browserStorage, readItem, writeItem } from '#lib/storage';

// Per TV browser, not per profile. It's a property of the room. On by default.
const KEY = 'pivi.ambientMusic';
const storage = browserStorage(browser);

/** Read by the root layout to play background music on the home screen, flipped from the home page. */
export const ambientMusic = $state({ enabled: readItem(storage, KEY) !== 'off' });

/** The home page's music toggle. Persists so the choice sticks for this TV. */
export function toggleAmbientMusic() {
	ambientMusic.enabled = !ambientMusic.enabled;
	writeItem(storage, KEY, ambientMusic.enabled ? 'on' : 'off');
}
