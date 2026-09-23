import { hashPin, verifyPin } from '#lib/crypto/pin';
import { clearActiveProfile, setActiveProfile } from './activeProfile';
import { db } from './db';
import { user } from './db/schema';
import { userPubsub } from './handlers/user';

export class AuthError extends Error {}

// The PIN is only 4 digits (10,000 combinations), so without a lockout it's
// trivially brute-forceable over plain GraphQL requests. Keyed by username
// rather than IP since that's the actual space being guessed; a locked-out
// username stays locked regardless of which connection is guessing it.
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

export async function registerWithPin(username: string, pin: string) {
	const existing = await db.query.user.findFirst({ where: { username: { eq: username } } });
	if (existing) throw new AuthError('Username is already taken');

	const pinHash = await hashPin(pin);
	const [created] = await db.insert(user).values({ username, pinHash }).returning();
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
	return existing;
}

export function logout() {
	clearActiveProfile();
}
