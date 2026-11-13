import { randomBytes } from '@noble/hashes/utils.js';
import {
	fromBase64Url,
	generateIdentityKeypair,
	toBase64Url,
	type Keypair
} from '#lib/crypto/pairing';
import { db } from './db';
import { tvIdentity } from './db/schema';

// The token in the pairing QR code is the only secret a phone needs to pair,
// so it is short lived, single use and held in memory only (a restart
// invalidates every open code).
export const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;
const pendingTokens = new Map<string, number>();

function pruneExpiredTokens() {
	const now = Date.now();
	for (const [token, expiresAt] of pendingTokens) {
		if (expiresAt <= now) pendingTokens.delete(token);
	}
}

/** hooks.server.ts mints one per TV visit to put in the pairing QR code. */
export function createPairingToken(): string {
	pruneExpiredTokens();
	const token = toBase64Url(randomBytes(32));
	pendingTokens.set(token, Date.now() + PAIRING_TOKEN_TTL_MS);
	return token;
}

/** Checked by hooks.server.ts to re-mint stale cookies and by the relay before a phone pairs. */
export function isPairingTokenValid(token: string): boolean {
	pruneExpiredTokens();
	return pendingTokens.has(token);
}

/**
 * The relay burns the token once pairing succeeded, so a leaked QR code can't
 * pair a second phone.
 */
export function consumePairingToken(token: string): boolean {
	pruneExpiredTokens();
	return pendingTokens.delete(token);
}

// The TV's long lived keypair. A phone pins its public key when pairing and
// checks the relay's signature against it on every reconnect, so this has to
// stay the same across restarts, hence the database row.
let cachedTvIdentity: Keypair | undefined;

/** The relay signs pairing and reconnect handshakes with this. Cached, so cheap per handshake. */
export async function getOrCreateTvIdentity(): Promise<Keypair> {
	if (cachedTvIdentity) return cachedTvIdentity;

	const existing = await db.query.tvIdentity.findFirst({ where: { id: 'singleton' } });
	if (existing) {
		cachedTvIdentity = {
			publicKey: fromBase64Url(existing.publicKey),
			secretKey: fromBase64Url(existing.secretKey)
		};
		return cachedTvIdentity;
	}

	const generated = generateIdentityKeypair();
	await db
		.insert(tvIdentity)
		.values({
			id: 'singleton',
			publicKey: toBase64Url(generated.publicKey),
			secretKey: toBase64Url(generated.secretKey)
		})
		.onConflictDoNothing();

	// Another connection may have raced us into creating the row. Re-read so
	// every process agrees on the one identity that ends up persisted.
	const row = await db.query.tvIdentity.findFirst({ where: { id: 'singleton' } });
	if (!row) throw new Error('Failed to create TV identity');

	cachedTvIdentity = {
		publicKey: fromBase64Url(row.publicKey),
		secretKey: fromBase64Url(row.secretKey)
	};
	return cachedTvIdentity;
}
