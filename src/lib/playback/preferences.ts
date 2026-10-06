import { readItem, writeItem, type KeyValueStorage } from '../storage';

// Player settings remembered per TV browser, so they survive between videos.
// Storage may be unavailable, so every accessor takes null and falls back to defaults.
const VOLUME_KEY = 'pivi:player:volume';
const SKIP_ACTIVE_KEY = 'pivi:player:skipActive';
const SUBTITLE_KEY = 'pivi:player:subtitleLanguage';

/** Also guards volume values arriving from the phone. */
export function clampVolume(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Restores the last volume on the play page, full volume when nothing valid is stored. */
export function loadVolume(storage: KeyValueStorage | null): number {
	const stored = readItem(storage, VOLUME_KEY);
	if (stored === null) return 1;
	const value = Number(stored);
	return Number.isFinite(value) ? clampVolume(value) : 1;
}

/** Called by the play page whenever the volume changes. */
export function saveVolume(storage: KeyValueStorage | null, volume: number) {
	writeItem(storage, VOLUME_KEY, String(volume));
}

/** Initial state of the skip toggle. On by default, only people who want the sections need to opt out. */
export function loadSkipActive(storage: KeyValueStorage | null): boolean {
	const stored = readItem(storage, SKIP_ACTIVE_KEY);
	return stored === null ? true : stored === 'true';
}

/** Called by skipController whenever the toggle flips. */
export function saveSkipActive(storage: KeyValueStorage | null, active: boolean) {
	writeItem(storage, SKIP_ACTIVE_KEY, String(active));
}

/** Restores the viewer's last subtitle pick, null (off) when none. Only shows where the video offers it. */
export function loadSubtitleLanguage(storage: KeyValueStorage | null): string | null {
	return readItem(storage, SUBTITLE_KEY);
}

/** Called by the play page when a subtitle is picked on the TV or the phone. */
export function saveSubtitleLanguage(storage: KeyValueStorage | null, language: string | null) {
	writeItem(storage, SUBTITLE_KEY, language);
}

/** A phone may still show the previous session's tracks, so only offered languages count. */
export function isOfferedSubtitle(
	tracks: readonly { language: string }[],
	language: string | null
): boolean {
	return language === null || tracks.some((t) => t.language === language);
}
