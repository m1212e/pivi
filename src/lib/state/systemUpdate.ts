import { freshQuery } from '#lib/api/freshQuery';

/**
 * pivi's own update status, for the prompt after a login and the app settings.
 * Always a real round trip: the downloaded update appears without the page
 * knowing, and a stale "ready to install" would offer something already gone.
 */
export async function getSystemUpdate() {
	const result = await freshQuery.systemUpdate({
		supported: true,
		current: true,
		available: true,
		checking: true,
		installing: true,
		postponed: true
	});
	// Copied out of the client's memoized Proxy, see home/+page.svelte.
	return { ...result };
}

export type SystemUpdateView = Awaited<ReturnType<typeof getSystemUpdate>>;
