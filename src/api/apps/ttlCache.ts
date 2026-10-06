export type TtlCache<V> = {
	/** Undefined once the entry is older than the ttl. */
	get: (key: string) => V | undefined;
	set: (key: string, value: V) => void;
	/** Drops every entry whose key starts with the prefix, e.g. one app's `appId:`. */
	deletePrefix: (prefix: string) => void;
};

/**
 * For results that are slow to produce and safe to reuse for a while. Entries
 * expire lazily on read, so there is no timer to clean up.
 */
export function createTtlCache<V>(ttlMs: number): TtlCache<V> {
	const entries = new Map<string, { value: V; expiresAt: number }>();
	return {
		get(key) {
			const hit = entries.get(key);
			if (!hit) return undefined;
			if (hit.expiresAt <= Date.now()) {
				entries.delete(key);
				return undefined;
			}
			return hit.value;
		},
		set(key, value) {
			entries.set(key, { value, expiresAt: Date.now() + ttlMs });
		},
		deletePrefix(prefix) {
			for (const key of entries.keys()) {
				if (key.startsWith(prefix)) entries.delete(key);
			}
		}
	};
}
