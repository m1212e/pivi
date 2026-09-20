import { db } from '#lib/server/db';
import { activeProfile } from '#lib/server/db/schema';

const SINGLETON_ID = 'singleton';

export async function setActiveProfile(userId: string) {
	await db
		.insert(activeProfile)
		.values({ id: SINGLETON_ID, userId })
		.onConflictDoUpdate({ target: activeProfile.id, set: { userId } });
}

export async function clearActiveProfile() {
	await db
		.insert(activeProfile)
		.values({ id: SINGLETON_ID, userId: null })
		.onConflictDoUpdate({ target: activeProfile.id, set: { userId: null } });
}

export async function getActiveProfileUser() {
	const row = await db.query.activeProfile.findFirst({ where: { id: SINGLETON_ID } });
	if (!row?.userId) return null;

	return (await db.query.user.findFirst({ where: { id: row.userId } })) ?? null;
}
