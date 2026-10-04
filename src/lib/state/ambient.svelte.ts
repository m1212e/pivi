import { browser } from '$app/env';

// Whether the home screen's background music is on. Kept in localStorage
// (per TV browser, not per profile -- it's a property of the room, not the
// person), and on by default. Storage can be unavailable (private mode,
// blocked site data), so every access is guarded and the toggle still works
// for the current page load.
const KEY = 'pivi.ambientMusic';

function read(): boolean {
	if (!browser) return true;
	try {
		return localStorage.getItem(KEY) !== 'off';
	} catch {
		return true;
	}
}

export const ambientMusic = $state({ enabled: read() });

export function toggleAmbientMusic() {
	ambientMusic.enabled = !ambientMusic.enabled;
	try {
		localStorage.setItem(KEY, ambientMusic.enabled ? 'on' : 'off');
	} catch {
		// Not persisted; fine.
	}
}
