import { db } from '../db';

let activeUserId: string | null = null;

export function setActiveProfile(userId: string) {
	activeUserId = userId;
}

export function clearActiveProfile() {
	activeUserId = null;
}

export async function getActiveProfileUser() {
	if (!activeUserId) return null;

	return (await db.query.user.findFirst({ where: { id: activeUserId } })) ?? null;
}
