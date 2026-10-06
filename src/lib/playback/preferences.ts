import { readItem, writeItem, type KeyValueStorage } from '../storage';

const VOLUME_KEY = 'pivi:player:volume';
const SKIP_ACTIVE_KEY = 'pivi:player:skipActive';
const SUBTITLE_KEY = 'pivi:player:subtitleLanguage';

export function clampVolume(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function loadVolume(storage: KeyValueStorage | null): number {
	const stored = readItem(storage, VOLUME_KEY);
	if (stored === null) return 1;
	const value = Number(stored);
	return Number.isFinite(value) ? clampVolume(value) : 1;
}

export function saveVolume(storage: KeyValueStorage | null, volume: number) {
	writeItem(storage, VOLUME_KEY, String(volume));
}

// On by default, only people who want the sections need to opt out.
export function loadSkipActive(storage: KeyValueStorage | null): boolean {
	const stored = readItem(storage, SKIP_ACTIVE_KEY);
	return stored === null ? true : stored === 'true';
}

export function saveSkipActive(storage: KeyValueStorage | null, active: boolean) {
	writeItem(storage, SKIP_ACTIVE_KEY, String(active));
}

// Off by default, a language picked for another video shouldn't carry over.
export function loadSubtitleLanguage(storage: KeyValueStorage | null): string | null {
	return readItem(storage, SUBTITLE_KEY);
}

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
