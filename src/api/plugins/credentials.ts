// Encrypted-at-rest storage for the opaque per-(user, plugin) blob behind
// the plugin/credentialGet and plugin/credentialSet RPC calls in
// src/lib/plugins/host.ts. The host never looks inside the blob — it's a
// plugin-defined JSON string (an OAuth refresh token, for the YouTube
// plugin) — only encrypts/decrypts and stores it.
import { and, eq } from 'drizzle-orm';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
	decrypt,
	encrypt,
	fromBase64Url,
	toBase64Url,
	utf8ToBytes,
	bytesToUtf8
} from '#lib/crypto/pairing';
import { db } from '../db';
import { pluginCredential } from '../db/schema';
import { getOrCreateTvIdentity } from '../pairing';

// Derived from the same TV identity keypair already persisted for the
// pairing handshake (see pairing.ts) rather than a separate stored secret —
// one root key for the device instead of two.
let cachedKey: Uint8Array | undefined;

async function getEncryptionKey(): Promise<Uint8Array> {
	if (cachedKey) return cachedKey;
	const identity = await getOrCreateTvIdentity();
	cachedKey = hkdf(
		sha256,
		identity.secretKey,
		undefined,
		utf8ToBytes('pivi-plugin-credentials'),
		32
	);
	return cachedKey;
}

export async function getPluginCredential(
	userId: string,
	pluginId: string
): Promise<string | null> {
	const row = await db.query.pluginCredential.findFirst({
		where: { userId: { eq: userId }, pluginId: { eq: pluginId } }
	});
	if (!row) return null;

	const key = await getEncryptionKey();
	return bytesToUtf8(decrypt(key, fromBase64Url(row.nonce), fromBase64Url(row.ciphertext)));
}

export async function setPluginCredential(
	userId: string,
	pluginId: string,
	value: string
): Promise<void> {
	const key = await getEncryptionKey();
	const { nonce, ciphertext } = encrypt(key, utf8ToBytes(value));
	const encoded = { nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext) };

	const existing = await db.query.pluginCredential.findFirst({
		where: { userId: { eq: userId }, pluginId: { eq: pluginId } }
	});
	if (existing) {
		await db
			.update(pluginCredential)
			.set(encoded)
			.where(and(eq(pluginCredential.userId, userId), eq(pluginCredential.pluginId, pluginId)));
	} else {
		await db.insert(pluginCredential).values({ userId, pluginId, ...encoded });
	}
}
