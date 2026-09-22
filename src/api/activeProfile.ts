import { db } from './db';

let activeUserId: string | null = null;

// Lets anything that depends on "which profile is active" react to a switch
// instead of only ever seeing whatever was active when it started -- the
// plugin host (runtime.ts) uses this to tell a running plugin process to
// reload its account-bound state (see plugins/youtube/innertube.ts).
type ActiveProfileListener = () => void;
const listeners = new Set<ActiveProfileListener>();

export function onActiveProfileChanged(listener: ActiveProfileListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function notifyActiveProfileChanged() {
	for (const listener of listeners) listener();
}

export function setActiveProfile(userId: string) {
	activeUserId = userId;
	notifyActiveProfileChanged();
}

export function clearActiveProfile() {
	activeUserId = null;
	notifyActiveProfileChanged();
}

export async function getActiveProfileUser() {
	if (!activeUserId) return null;

	return (await db.query.user.findFirst({ where: { id: activeUserId } })) ?? null;
}
