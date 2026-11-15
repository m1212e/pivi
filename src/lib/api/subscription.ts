// Stops a subscription returned by the generated client's `.subscribe()`.
//
// The generated type says that's a plain unsubscribe function, but at runtime
// it's an ES Observable `Subscription` object with an `.unsubscribe()` method
// (it comes from wonka, under the generated client) — calling the return value
// directly throws "not a function" the first time cleanup actually runs
// (client-side navigation away from the page). Handling both keeps the page
// correct if either side of that mismatch is ever fixed.
export function stopSubscription(subscription: unknown): void {
	if (typeof subscription === 'function') subscription();
	else (subscription as { unsubscribe(): void }).unsubscribe();
}

/**
 * Keeps a page's copy of some data live without trusting urql's cache.
 *
 * A liveQuery's `.subscribe()` starts by replaying the query from the cache,
 * which holds whatever the last visit saw (its subscription pushes don't
 * update that cached copy), and the server only pushes on changes, so a page
 * opened again can be stuck on outdated data. This follows the push-only
 * subscription instead, plus one network fetch for anything that changed
 * before it started, ignored if a push already came in. Returns the cleanup.
 */
export function followLive<T>(
	subscribe: (onValue: (value: T | null | undefined) => void) => unknown,
	refetch: () => Promise<NoInfer<T> | null | undefined>,
	apply: (value: T) => void
): () => void {
	let pushed = false;
	const subscription = subscribe((value) => {
		if (!value) return;
		pushed = true;
		apply(value);
	});
	refetch()
		.then((value) => {
			if (value && !pushed) apply(value);
		})
		.catch(() => {});
	return () => stopSubscription(subscription);
}
