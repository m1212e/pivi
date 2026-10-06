// Last known "is a newer image on the registry" answer per app, behind the home
// screen's update badge (see updateAvailability.ts). Lives apart so the updater
// can drop an entry the moment it changes what's installed, without importing
// the module that imports it.
type AvailabilityEntry = { checkedAt: number; hasUpdate: boolean };

const cache = new Map<string, AvailabilityEntry>();

export const availabilityCache = {
	get: (appId: string) => cache.get(appId),
	set: (appId: string, entry: AvailabilityEntry) => void cache.set(appId, entry),
	forget: (appId: string) => void cache.delete(appId)
};
