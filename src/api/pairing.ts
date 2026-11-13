import { randomBytes } from '@noble/hashes/utils.js';
import {
	fromBase64Url,
	generateIdentityKeypair,
	pairingTokenId,
	toBase64Url,
	type Keypair
} from '#lib/crypto/pairing';
import { db } from './db';
import { tvIdentity } from './db/schema';

// The token in the pairing QR code is the only secret a phone needs to pair,
// so it is short lived, single use and held in memory only (a restart
// invalidates every open code). Keyed by pairingTokenId, which is all the
// phone sends, the token itself never leaves the QR code.
export const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;
// Only the TV's own pages mint tokens, one per cookie, so a handful is plenty.
// The cap just keeps a misbehaving client from growing the map without bound.
const MAX_PENDING_TOKENS = 16;
const pendingTokens = new Map<string, { token: string; expiresAt: number }>();

function pruneExpiredTokens() {
	const now = Date.now();
	for (const [id, { expiresAt }] of pendingTokens) {
		if (expiresAt <= now) pendingTokens.delete(id);
	}
}

/** hooks.server.ts mints one per TV visit to put in the pairing QR code. */
export function createPairingToken(): string {
	pruneExpiredTokens();
	// Maps iterate in insertion order, so this drops the oldest.
	while (pendingTokens.size >= MAX_PENDING_TOKENS) {
		pendingTokens.delete(pendingTokens.keys().next().value!);
	}
	const token = toBase64Url(randomBytes(32));
	pendingTokens.set(pairingTokenId(token), { token, expiresAt: Date.now() + PAIRING_TOKEN_TTL_MS });
	return token;
}

/** Checked by hooks.server.ts to re-mint stale cookies. */
export function isPairingTokenValid(token: string): boolean {
	pruneExpiredTokens();
	return pendingTokens.get(pairingTokenId(token))?.token === token;
}

/** How the relay finds the token a pairing phone names by its id. */
export function pairingTokenFor(tokenId: string): string | undefined {
	pruneExpiredTokens();
	return pendingTokens.get(tokenId)?.token;
}

/**
 * The relay burns the token as soon as a phone proved it knows it, so a leaked
 * QR code can't pair a second phone. Returns its expiry for
 * restorePairingToken, or undefined when it was already gone.
 */
export function consumePairingToken(token: string): number | undefined {
	pruneExpiredTokens();
	const id = pairingTokenId(token);
	const entry = pendingTokens.get(id);
	if (entry?.token !== token) return undefined;
	pendingTokens.delete(id);
	return entry.expiresAt;
}

/** Puts a consumed token back after a failure that wasn't the phone's fault. */
export function restorePairingToken(token: string, expiresAt: number) {
	pendingTokens.set(pairingTokenId(token), { token, expiresAt });
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
