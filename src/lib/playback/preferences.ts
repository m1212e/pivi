export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const VOLUME_KEY = 'pivi:player:volume';
const SKIP_ACTIVE_KEY = 'pivi:player:skipActive';
const SUBTITLE_KEY = 'pivi:player:subtitleLanguage';

export function clampVolume(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * Storage for the current runtime, or null on the server. Some server
 * runtimes stub a localStorage that warns instead of throwing, so the
 * caller's `browser` flag is what decides, not a try/catch.
 */
export function browserStorage(isBrowser: boolean): KeyValueStorage | null {
	if (!isBrowser) return null;
	try {
		return localStorage;
	} catch {
		return null;
	}
}

// Storage throws in private browsing.
function read(storage: KeyValueStorage | null, key: string): string | null {
	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function write(storage: KeyValueStorage | null, key: string, value: string | null) {
	try {
		if (value === null) storage?.removeItem(key);
		else storage?.setItem(key, value);
	} catch {
		// nothing to persist to
	}
}

export function loadVolume(storage: KeyValueStorage | null): number {
	const stored = read(storage, VOLUME_KEY);
	if (stored === null) return 1;
	const value = Number(stored);
	return Number.isFinite(value) ? clampVolume(value) : 1;
}

export function saveVolume(storage: KeyValueStorage | null, volume: number) {
	write(storage, VOLUME_KEY, String(volume));
}

// On by default, only people who want the sections need to opt out.
export function loadSkipActive(storage: KeyValueStorage | null): boolean {
	const stored = read(storage, SKIP_ACTIVE_KEY);
	return stored === null ? true : stored === 'true';
}

export function saveSkipActive(storage: KeyValueStorage | null, active: boolean) {
	write(storage, SKIP_ACTIVE_KEY, String(active));
}

// Off by default, a language picked for another video shouldn't carry over.
export function loadSubtitleLanguage(storage: KeyValueStorage | null): string | null {
	return read(storage, SUBTITLE_KEY);
}

export function saveSubtitleLanguage(storage: KeyValueStorage | null, language: string | null) {
	write(storage, SUBTITLE_KEY, language);
}

/** A phone may still show the previous session's tracks, so only offered languages count. */
export function isOfferedSubtitle(
	tracks: readonly { language: string }[],
	language: string | null
): boolean {
	return language === null || tracks.some((t) => t.language === language);
}
