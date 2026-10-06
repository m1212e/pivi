import { db } from './db';

// The device has a single active profile (one TV), so it lives in memory
// rather than in a per-browser session. A restart logs everyone out.
let activeUserId: string | null = null;

type ActiveProfileListener = () => void;
const listeners = new Set<ActiveProfileListener>();

/**
 * Lets the app manager (apps/manager.ts) stop every running app on a profile
 * switch, so no account bound state leaks into the next profile.
 * Returns an unsubscribe function.
 */
export function onActiveProfileChanged(listener: ActiveProfileListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function notifyActiveProfileChanged() {
	for (const listener of listeners) listener();
}

/** Login and register (auth.ts) call this to switch the whole device to that profile. */
export function setActiveProfile(userId: string) {
	activeUserId = userId;
	notifyActiveProfileChanged();
}

/** Backs logout (auth.ts), which signs out the device rather than one browser. */
export function clearActiveProfile() {
	activeUserId = null;
	notifyActiveProfileChanged();
}

/**
 * Source of truth for "who is logged in", read by hooks.server.ts for every
 * request and by the app manager before spawning apps. Null when nobody is
 * logged in or the active user's row no longer exists.
 */
export async function getActiveProfileUser() {
	if (!activeUserId) return null;

	return (await db.query.user.findFirst({ where: { id: activeUserId } })) ?? null;
}
