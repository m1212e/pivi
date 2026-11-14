// When the active profile last opened each app, so the home screen lists the
// apps it actually uses first. "Opened" is the person's doing: an app screen
// shown or something of the app played. Background work (dashboard refreshes,
// an app kept running) never counts, unlike usage.ts's idle tracking.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { appUsage } from '../db/schema';
import { APP_LIST_EVENT } from './events';
import { appPubSub } from './pubsub';

// A screen re-subscribes and a player re-queries often while in use. The
// order only needs minutes of precision, so one write per app and profile
// per window is plenty.
const WRITE_EVERY_MS = 60_000;
const lastWrite = new Map<string, number>();

/**
 * Records that `userId` just opened `appId`. Never throws: a failed write
 * only leaves the order as it was. The app list is re-sent, so an open home
 * screen (or the phone) picks up the new order.
 */
export async function markAppUsed(userId: string, appId: string): Promise<void> {
	const key = `${userId}\n${appId}`;
	const now = Date.now();
	if (now - (lastWrite.get(key) ?? 0) < WRITE_EVERY_MS) return;
	lastWrite.set(key, now);
	try {
		const lastUsedAt = new Date(now);
		await db
			.insert(appUsage)
			.values({ userId, appId, lastUsedAt })
			.onConflictDoUpdate({ target: [appUsage.userId, appUsage.appId], set: { lastUsedAt } });
		appPubSub.publish(APP_LIST_EVENT);
	} catch (err) {
		lastWrite.delete(key);
		console.warn(`[appUsage] could not record ${appId}: ${String(err)}`);
	}
}

/** When `userId` last opened each app, by app id. Empty when signed out. */
export async function lastUsedByApp(userId: string | undefined): Promise<Map<string, number>> {
	if (!userId) return new Map();
	const rows = await db
		.select({ appId: appUsage.appId, lastUsedAt: appUsage.lastUsedAt })
		.from(appUsage)
		.where(eq(appUsage.userId, userId));
	return new Map(rows.map((row) => [row.appId, row.lastUsedAt.getTime()]));
}

/**
 * Most recently opened first. Apps never opened keep their given order
 * (install order) after those. Sorting is stable, so ties keep it too.
 */
export function sortByLastUsed<T>(
	items: T[],
	idOf: (item: T) => string,
	lastUsed: Map<string, number>
): T[] {
	return [...items].sort((a, b) => {
		const left = lastUsed.get(idOf(a));
		const right = lastUsed.get(idOf(b));
		if (left === undefined || right === undefined) {
			return left === right ? 0 : left === undefined ? 1 : -1;
		}
		return right - left;
	});
}
