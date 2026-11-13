// One guarded way to touch localStorage for the ambient music toggle, playback
// preferences and the remote's last tab. Each needs the same tolerance for
// private mode and blocked site data.

/** Narrow type so tests can pass a plain fake instead of the real Storage. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Storage for the current runtime, or null on the server. Some server
 * runtimes stub a localStorage that warns instead of throwing, so the
 * caller's `browser` flag decides, not a try/catch.
 */
export function browserStorage(isBrowser: boolean): KeyValueStorage | null {
	if (!isBrowser) return null;
	try {
		return localStorage;
	} catch {
		return null;
	}
}

/** Null when missing, unreadable or without storage, so callers just fall back to a default. */
export function readItem(storage: KeyValueStorage | null, key: string): string | null {
	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

/** A null value removes the key. Failures are swallowed, there is nothing to fall back to. */
export function writeItem(storage: KeyValueStorage | null, key: string, value: string | null) {
	try {
		if (value === null) storage?.removeItem(key);
		else storage?.setItem(key, value);
	} catch {
		// private mode or blocked site data
	}
}
