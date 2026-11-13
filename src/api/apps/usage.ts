// What counts as an app being in use, so manager.ts can stop the ones that
// aren't instead of leaving every installed app running from login onwards.
//
// In use means the user is doing something with it: a screen of it is open
// (a hold for as long as its subscription lives), it is streaming (a hold for
// an ffmpeg remux, a touch on every track range request), or the host asked it
// something or forwarded a UI event within the idle window. Showing its cards on
// the home screen doesn't count: those stay visible from the last publish
// after the app is stopped, so the home screen alone never keeps an app awake.

/** Ten minutes covers stepping away from an app and coming back to it. */
export const IDLE_STOP_MS = 10 * 60_000;

/** Created once by manager.ts. `now` is injectable for the tests. */
export function createUsageTracker(idleMs = IDLE_STOP_MS, now = Date.now) {
	const lastUsed = new Map<string, number>();
	const holds = new Map<string, number>();

	function touch(appId: string): void {
		lastUsed.set(appId, now());
	}

	return {
		touch,

		/** Keeps the app in use until the returned release is called. Safe to release twice. */
		hold(appId: string): () => void {
			holds.set(appId, (holds.get(appId) ?? 0) + 1);
			touch(appId);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const remaining = (holds.get(appId) ?? 1) - 1;
				if (remaining > 0) holds.set(appId, remaining);
				else holds.delete(appId);
				// The idle window starts when the screen closes or the stream ends.
				touch(appId);
			};
		},

		/** Which of `running` nobody has used for the idle window. */
		idle(running: Iterable<string>): string[] {
			const at = now();
			return [...running].filter(
				(appId) => !holds.has(appId) && at - (lastUsed.get(appId) ?? at) >= idleMs
			);
		}
	};
}

/**
 * Wraps a subscription's iterator so `release` runs once it ends, however it
 * ends. Hand written because an async generator queues `return()` behind a
 * pending `next()`, so an unsubscribe wouldn't release until the next event.
 */
export function releaseWhenDone<T>(
	source: AsyncIterable<T>,
	release: () => void
): AsyncIterableIterator<T> {
	const inner = source[Symbol.asyncIterator]();
	let released = false;
	const releaseOnce = () => {
		if (released) return;
		released = true;
		release();
	};
	return {
		async next() {
			const result = await inner.next();
			if (result.done) releaseOnce();
			return result;
		},
		async return(value?: unknown) {
			releaseOnce();
			return (await inner.return?.(value)) ?? { done: true, value: undefined };
		},
		throw(error?: unknown) {
			releaseOnce();
			return inner.throw ? inner.throw(error) : Promise.reject(error);
		},
		[Symbol.asyncIterator]() {
			return this;
		}
	};
}
