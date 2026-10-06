// Crypto primitives for the phone-pairing / reconnect handshake (see
// src/api/ws/relay.ts and src/lib/pairing/session.ts). Pure JS/TS (@noble/*),
// so this same module runs unmodified in the browser and in the Node
// backend. That keeps one implementation of the handshake math.
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

/** Raw key bytes, stored base64url by the server and as bytes by the phone. */
export type Keypair = { publicKey: Uint8Array; secretKey: Uint8Array };

/** Long lived signing identity of the TV or a phone, proves who it is on reconnect. */
export function generateIdentityKeypair(): Keypair {
	return ed25519.keygen();
}

/** Throwaway key for one handshake, so past sessions stay safe if a long lived key leaks. */
export function generateEphemeralKeypair(): Keypair {
	return x25519.keygen();
}

/** Both handshake sides derive the same secret from their ephemeral keys, the input to deriveSessionKeys. */
export function deriveSharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
	return x25519.getSharedSecret(secretKey, peerPublicKey);
}

/** Each side signs the handshake transcript with its identity key, so a man in the middle can't swap ephemeral keys. */
export function sign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
	return ed25519.sign(message, secretKey);
}

/** Returns false instead of throwing on malformed input, so callers can treat it as a plain rejection. */
export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
	try {
		return ed25519.verify(signature, message, publicKey);
	} catch {
		return false;
	}
}

/**
 * Binds the keys to the handshake transcript and splits them per direction,
 * so a reflected ciphertext can never be replayed back at its sender.
 */
export function deriveSessionKeys(
	sharedSecret: Uint8Array,
	transcript: Uint8Array
): { c2sKey: Uint8Array; s2cKey: Uint8Array } {
	const prk = hkdf(sha256, sharedSecret, transcript, utf8ToBytes('pivi-session'), 64);
	return { c2sKey: prk.slice(0, 32), s2cKey: prk.slice(32, 64) };
}

/** Encrypts each relayed remote message. Fresh random nonce per message, 24 bytes makes collisions a non issue. */
export function encrypt(
	key: Uint8Array,
	plaintext: Uint8Array
): { nonce: Uint8Array; ciphertext: Uint8Array } {
	const nonce = randomBytes(24);
	const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
	return { nonce, ciphertext };
}

/** Throws when the ciphertext was tampered with or used the wrong key. */
export function decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
	return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

/** Builds the handshake transcript both sides sign and derive keys from. */
export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/** Turns JSON messages and labels into bytes for signing and encryption. */
export function utf8ToBytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

/** Reads decrypted relay messages back as JSON text. */
export function bytesToUtf8(value: Uint8Array): string {
	return new TextDecoder().decode(value);
}

/** Keys, nonces and tokens travel as text in JSON messages, links and QR codes, so URL safe. */
export function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Reverses toBase64Url, also used for the PIN hashes. */
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
