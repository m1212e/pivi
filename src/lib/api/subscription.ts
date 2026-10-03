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
