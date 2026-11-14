// Operations on one app (update check, approval, permission change, uninstall)
// all read the row, do slow work and write it back. Run concurrently, the
// later write silently undoes the earlier one, e.g. an update check restoring a
// permission the user had just switched off. So they queue per app instead.
// Different apps stay independent. Not re-entrant: a locked function must not
// call another one for the same app.
const tails = new Map<string, Promise<unknown>>();

export function withAppLock<T>(appId: string, task: () => Promise<T>): Promise<T> {
	const previous = tails.get(appId) ?? Promise.resolve();
	const run = previous.then(task, task);
	const tail = run.catch(() => {});
	tails.set(appId, tail);
	void tail.then(() => {
		if (tails.get(appId) === tail) tails.delete(appId);
	});
	return run;
}
