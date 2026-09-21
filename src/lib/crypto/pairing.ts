// Crypto primitives for the phone-pairing / reconnect handshake (see
// src/api/ws/relay.ts and src/lib/pairing/session.ts). Pure JS/TS (@noble/*),
// so this same module runs unmodified in the browser and in the Node
// backend — there is exactly one implementation of the handshake math.
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

export type Keypair = { publicKey: Uint8Array; secretKey: Uint8Array };

export function generateIdentityKeypair(): Keypair {
	return ed25519.keygen();
}

export function generateEphemeralKeypair(): Keypair {
	return x25519.keygen();
}

export function deriveSharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
	return x25519.getSharedSecret(secretKey, peerPublicKey);
}

export function sign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
	return ed25519.sign(message, secretKey);
}

export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
	try {
		return ed25519.verify(signature, message, publicKey);
	} catch {
		return false;
	}
}

// The final shared secret from an ephemeral X25519 exchange, run through
// HKDF against the handshake transcript, split into one key per direction so
// a reflected ciphertext can never be replayed back at its sender.
export function deriveSessionKeys(
	sharedSecret: Uint8Array,
	transcript: Uint8Array
): { c2sKey: Uint8Array; s2cKey: Uint8Array } {
	const prk = hkdf(sha256, sharedSecret, transcript, utf8ToBytes('pivi-session'), 64);
	return { c2sKey: prk.slice(0, 32), s2cKey: prk.slice(32, 64) };
}

export function encrypt(
	key: Uint8Array,
	plaintext: Uint8Array
): { nonce: Uint8Array; ciphertext: Uint8Array } {
	const nonce = randomBytes(24);
	const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
	return { nonce, ciphertext };
}

export function decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
	return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export function utf8ToBytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

export function bytesToUtf8(value: Uint8Array): string {
	return new TextDecoder().decode(value);
}

export function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
	const padded = value
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
