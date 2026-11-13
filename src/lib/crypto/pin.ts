// PIN hashing for the profile PIN pad (see src/api/auth.ts). Server-only,
// scryptAsync's cost is tuned for a background auth check, not a keystroke.
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { fromBase64Url, toBase64Url, utf8ToBytes } from './pairing';

const SCRYPT_OPTS = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 };

/** Stored as `salt:hash`, the random salt keeps equal PINs from hashing equally. */
export async function hashPin(pin: string): Promise<string> {
	const salt = randomBytes(16);
	const derived = await scryptAsync(utf8ToBytes(pin), salt, SCRYPT_OPTS);
	return `${toBase64Url(salt)}:${toBase64Url(derived)}`;
}

/** Compares in constant time so response timing doesn't leak how much of the PIN matched. */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
	const [saltPart, derivedPart] = hash.split(':');
	if (!saltPart || !derivedPart) return false;

	const salt = fromBase64Url(saltPart);
	const expected = fromBase64Url(derivedPart);
	const actual = await scryptAsync(utf8ToBytes(pin), salt, SCRYPT_OPTS);
	return constantTimeEqual(actual, expected);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
