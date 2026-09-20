import { randomBytes } from 'node:crypto';

// In-memory pairing store: bridges a phone's "remote control" session back to
// the TV's browser session. The TV shows a QR code with a token; the phone
// signs in/registers against that token; the TV polls and, once resolved,
// adopts the resulting session cookie as its own.
const TTL_MS = 10 * 60 * 1000;

interface PairingEntry {
	createdAt: number;
	cookie?: string;
}

const pairings = new Map<string, PairingEntry>();

function cleanup() {
	const cutoff = Date.now() - TTL_MS;
	for (const [token, entry] of pairings) {
		if (entry.createdAt < cutoff) pairings.delete(token);
	}
}

export function createPairing() {
	cleanup();
	const token = randomBytes(16).toString('hex');
	pairings.set(token, { createdAt: Date.now() });
	return token;
}

export function isPairingPending(token: string) {
	cleanup();
	return pairings.has(token);
}

export function resolvePairing(token: string, cookie: string) {
	const entry = pairings.get(token);
	if (!entry) return false;
	entry.cookie = cookie;
	return true;
}

export function consumeResolvedPairing(token: string) {
	cleanup();
	const entry = pairings.get(token);
	if (!entry?.cookie) return undefined;
	pairings.delete(token);
	return entry.cookie;
}
