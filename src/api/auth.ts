import { hashPin, verifyPin } from '#lib/crypto/pin';
import { clearActiveProfile, setActiveProfile } from './activeProfile';
import { db } from './db';
import { user } from './db/schema';
import { userPubsub } from './handlers/user';

export class AuthError extends Error {}

export async function registerWithPin(username: string, pin: string) {
	const existing = await db.query.user.findFirst({ where: { username: { eq: username } } });
	if (existing) throw new AuthError('Username is already taken');

	const pinHash = await hashPin(pin);
	const [created] = await db.insert(user).values({ username, pinHash }).returning();
	userPubsub.created();
	setActiveProfile(created.id);
	return created;
}

export async function loginWithPin(username: string, pin: string) {
	const existing = await db.query.user.findFirst({ where: { username: { eq: username } } });
	if (!existing || !(await verifyPin(pin, existing.pinHash))) {
		throw new AuthError('Wrong PIN');
	}

	setActiveProfile(existing.id);
	return existing;
}

export function logout() {
	clearActiveProfile();
}
