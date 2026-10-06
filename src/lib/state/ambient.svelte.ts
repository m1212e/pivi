import { browser } from '$app/env';
import { browserStorage, readItem, writeItem } from '#lib/storage';

// Per TV browser, not per profile. It's a property of the room. On by default.
const KEY = 'pivi.ambientMusic';
const storage = browserStorage(browser);

export const ambientMusic = $state({ enabled: readItem(storage, KEY) !== 'off' });

export function toggleAmbientMusic() {
	ambientMusic.enabled = !ambientMusic.enabled;
	writeItem(storage, KEY, ambientMusic.enabled ? 'on' : 'off');
}
