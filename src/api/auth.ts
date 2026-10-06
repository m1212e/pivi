import { hashPin, verifyPin } from '#lib/crypto/pin';
import { clearActiveProfile, setActiveProfile } from './activeProfile';
import { getStartedApps } from './apps/manager';
import { db } from './db';
import { user } from './db/schema';
import { userPubsub } from './handlers/user';

/** Lets handlers/auth.ts tell user facing failures (shown as is) from internal errors (masked). */
export class AuthError extends Error {}

// A 4 digit PIN is trivially brute forced over GraphQL without a lockout.
// Keyed by username rather than IP since that's the space being guessed, so a
// locked username stays locked whichever connection is guessing.
const MAX_ATTEMPTS_BEFORE_LOCKOUT = 5;
const BASE_LOCKOUT_MS = 5_000;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;
// Old failure counts shouldn't haunt a username forever once nobody's
// actively guessing it, so entries idle past this just get pruned away.
const ATTEMPT_MEMORY_MS = 30 * 60 * 1000;

type LoginAttempts = { failures: number; lastFailureAt: number; lockedUntil: number };
const loginAttempts = new Map<string, LoginAttempts>();

function pruneLoginAttempts() {
	const now = Date.now();
	for (const [key, state] of loginAttempts) {
		if (state.lockedUntil <= now && now - state.lastFailureAt > ATTEMPT_MEMORY_MS) {
			loginAttempts.delete(key);
		}
	}
}

function recordFailedLogin(username: string, state: LoginAttempts | undefined) {
	const failures = (state?.failures ?? 0) + 1;
	let lockedUntil = 0;
	if (failures >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
		// Doubles per failure past the threshold, so a sustained bruteforce
		// keeps getting slower instead of settling into one fixed wait.
		const extra = failures - MAX_ATTEMPTS_BEFORE_LOCKOUT;
		lockedUntil = Date.now() + Math.min(BASE_LOCKOUT_MS * 2 ** extra, MAX_LOCKOUT_MS);
	}
	loginAttempts.set(username, { failures, lastFailureAt: Date.now(), lockedUntil });
}

/** Backs the register mutation. Makes the new profile active, so a new user lands logged in. */
export async function registerWithPin(username: string, pin: string) {
	const existing = await db.query.user.findFirst({ where: { username: { eq: username } } });
	if (existing) throw new AuthError('Username is already taken');

	const pinHash = await hashPin(pin);
	const [created] = await db.insert(user).values({ username, pinHash }).returning();
	// Subscribers of the user table need to learn about the new row.
	userPubsub.created();
	setActiveProfile(created.id);
	return created;
}

function checkNotLockedOut(state: LoginAttempts | undefined) {
	if (!state || state.lockedUntil <= Date.now()) return;
	const secondsLeft = Math.ceil((state.lockedUntil - Date.now()) / 1000);
	throw new AuthError(`Too many attempts, try again in ${secondsLeft}s`);
}

async function verifyCredentials(username: string, pin: string) {
	const existing = await db.query.user.findFirst({ where: { username: { eq: username } } });
	if (!existing) return null;
	return (await verifyPin(pin, existing.pinHash)) ? existing : null;
}

/**
 * Backs the login mutation. Throws AuthError on a wrong PIN or while the
 * username is locked out.
 */
export async function loginWithPin(username: string, pin: string) {
	pruneLoginAttempts();

	const state = loginAttempts.get(username);
	checkNotLockedOut(state);

	const existing = await verifyCredentials(username, pin);
	if (!existing) {
		recordFailedLogin(username, state);
		throw new AuthError('Wrong PIN');
	}

	loginAttempts.delete(username);
	setActiveProfile(existing.id);
	// Boot the apps now so they're ready by the time /home asks for them.
	void getStartedApps();
	return existing;
}

/** Backs the signOut mutation. Signs out the whole device, not just one browser. */
export function logout() {
	clearActiveProfile();
}
