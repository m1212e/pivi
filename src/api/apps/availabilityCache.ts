// Its own module so updater.ts can reach the cache without importing
// updateAvailability.ts, which imports the updater (a cycle otherwise).
type AvailabilityEntry = { checkedAt: number; hasUpdate: boolean };

const cache = new Map<string, AvailabilityEntry>();

/**
 * Remembers the home screen's "update available" answer per app so the badge
 * doesn't hit the registry on every page load (updateAvailability.ts). The
 * updater calls `forget` whenever it changes what's installed, so the badge
 * never lags behind an applied or rejected update.
 */
export const availabilityCache = {
	get: (appId: string) => cache.get(appId),
	set: (appId: string, entry: AvailabilityEntry) => void cache.set(appId, entry),
	forget: (appId: string) => void cache.delete(appId)
};
