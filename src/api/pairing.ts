import { randomBytes } from '@noble/hashes/utils.js';
import {
	fromBase64Url,
	generateIdentityKeypair,
	toBase64Url,
	type Keypair
} from '#lib/crypto/pairing';
import { db } from './db';
import { tvIdentity } from './db/schema';

const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;
const pendingTokens = new Map<string, number>();

function pruneExpiredTokens() {
	const now = Date.now();
	for (const [token, expiresAt] of pendingTokens) {
		if (expiresAt <= now) pendingTokens.delete(token);
	}
}

export function createPairingToken(): string {
	pruneExpiredTokens();
	const token = toBase64Url(randomBytes(32));
	pendingTokens.set(token, Date.now() + PAIRING_TOKEN_TTL_MS);
	return token;
}

// Single-use: a valid token is removed as soon as it's checked, regardless
// of whether the caller goes on to complete pairing.
export function consumePairingToken(token: string): boolean {
	pruneExpiredTokens();
	return pendingTokens.delete(token);
}

let cachedTvIdentity: Keypair | undefined;

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

	// Another connection may have raced us into creating the row; re-read so
	// every process agrees on the one identity that ends up persisted.
	const row = await db.query.tvIdentity.findFirst({ where: { id: 'singleton' } });
	if (!row) throw new Error('Failed to create TV identity');

	cachedTvIdentity = {
		publicKey: fromBase64Url(row.publicKey),
		secretKey: fromBase64Url(row.secretKey)
	};
	return cachedTvIdentity;
}
