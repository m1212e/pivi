// Crypto primitives for the phone-pairing / reconnect handshake (see
// src/api/ws/relay.ts and src/lib/remote/session.ts). Pure JS/TS (@noble/*),
// so this same module runs unmodified in the browser and in the Node
// backend. That keeps one implementation of the handshake math.
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

/** Raw key bytes, stored base64url by the server and as bytes by the phone. */
export type Keypair = { publicKey: Uint8Array; secretKey: Uint8Array };

/** Length of every public key in the handshake, ed25519 and x25519 alike. */
export const PUBLIC_KEY_BYTES = 32;
/** Length of an ed25519 signature. */
export const SIGNATURE_BYTES = 64;
const MAC_BYTES = 32;

// Bumped whenever the handshake bytes change, so a remote still running old
// code is turned away instead of failing a signature check.
export const HANDSHAKE_VERSION = 2;
const HANDSHAKE_LABEL = `pivi-remote-v${HANDSHAKE_VERSION}`;

/** Long lived signing identity of the TV or a phone, proves who it is on reconnect. */
export function generateIdentityKeypair(): Keypair {
	return ed25519.keygen();
}

/** The phone only stores its secret key, the transcript also needs the public half. */
export function identityPublicKey(secretKey: Uint8Array): Uint8Array {
	return ed25519.getPublicKey(secretKey);
}

/** Throwaway key for one handshake, so past sessions stay safe if a long lived key leaks. */
export function generateEphemeralKeypair(): Keypair {
	return x25519.keygen();
}

/** Both handshake sides derive the same secret from their ephemeral keys, the input to deriveSessionKeys. */
export function deriveSharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
	return x25519.getSharedSecret(secretKey, peerPublicKey);
}

/**
 * Everything both sides agree on, signed by both and fed into the key
 * derivation. Includes the long lived keys so a signature only counts for this
 * exact TV and device pair. All fields but the trailing deviceId are fixed
 * length, so the concatenation can't be read two ways.
 */
export function handshakeTranscript(parts: {
	phoneEphemeralPublicKey: Uint8Array;
	relayEphemeralPublicKey: Uint8Array;
	devicePublicKey: Uint8Array;
	tvPublicKey: Uint8Array;
	deviceId: string;
}): Uint8Array {
	return concatBytes(
		utf8ToBytes(HANDSHAKE_LABEL),
		parts.phoneEphemeralPublicKey,
		parts.relayEphemeralPublicKey,
		parts.devicePublicKey,
		parts.tvPublicKey,
		utf8ToBytes(parts.deviceId)
	);
}

type HandshakeRole = 'tv' | 'phone';

// The role prefix keeps one side's signature from ever passing as the other's.
function roleMessage(role: HandshakeRole, transcript: Uint8Array): Uint8Array {
	return concatBytes(utf8ToBytes(`${HANDSHAKE_LABEL} ${role}`), transcript);
}

/** Each side signs the transcript with its identity key, so a man in the middle can't swap ephemeral keys. */
export function signHandshake(
	secretKey: Uint8Array,
	role: HandshakeRole,
	transcript: Uint8Array
): Uint8Array {
	return ed25519.sign(roleMessage(role, transcript), secretKey);
}

/** Returns false instead of throwing on malformed input, so callers can treat it as a plain rejection. */
export function verifyHandshake(
	publicKey: Uint8Array,
	role: HandshakeRole,
	transcript: Uint8Array,
	signature: Uint8Array
): boolean {
	try {
		return ed25519.verify(signature, roleMessage(role, transcript), publicKey);
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

// The nonce is the frame's position in its direction. Keys are fresh per
// session, so a counter never repeats under one key, and a replayed, dropped
// or reordered frame is decrypted with the wrong nonce and rejected.
function counterNonce(counter: number): Uint8Array {
	const nonce = new Uint8Array(24);
	new DataView(nonce.buffer).setBigUint64(16, BigInt(counter));
	return nonce;
}

/** Encrypts one direction of a session. Frames must be delivered in the order they were sealed. */
export function createSealer(key: Uint8Array) {
	let counter = 0;
	return (plaintext: Uint8Array): Uint8Array =>
		xchacha20poly1305(key, counterNonce(counter++)).encrypt(plaintext);
}

/**
 * Decrypts one direction of a session. Throws on a tampered, replayed or
 * out of order frame, after which the session can't recover and should close.
 */
export function createOpener(key: Uint8Array) {
	let counter = 0;
	return (ciphertext: Uint8Array): Uint8Array => {
		const plaintext = xchacha20poly1305(key, counterNonce(counter)).decrypt(ciphertext);
		counter++;
		return plaintext;
	};
}

// The QR token never crosses the network. Both sides derive a MAC key and a
// lookup id from it, so a sniffer learns neither and can't pair in its place.
function pairingKey(token: string): Uint8Array {
	return hkdf(sha256, utf8ToBytes(token), undefined, utf8ToBytes('pivi-pairing-key'), MAC_BYTES);
}

/** How the relay finds a pending token without the phone sending the token itself. */
export function pairingTokenId(token: string): string {
	return toBase64Url(sha256(concatBytes(utf8ToBytes('pivi-pairing-id'), utf8ToBytes(token))));
}

/** The phone's proof that it scanned the QR code, bound to the device key it registers. */
export function pairRequestProof(token: string, devicePublicKey: Uint8Array): Uint8Array {
	return hmac(sha256, pairingKey(token), concatBytes(utf8ToBytes('request'), devicePublicKey));
}

/**
 * The relay's proof that it knows the same token, so the phone can trust the TV
 * key it gets back even over an unauthenticated connection.
 */
export function pairResponseProof(
	token: string,
	devicePublicKey: Uint8Array,
	tvPublicKey: Uint8Array,
	deviceId: string
): Uint8Array {
	return hmac(
		sha256,
		pairingKey(token),
		concatBytes(utf8ToBytes('response'), devicePublicKey, tvPublicKey, utf8ToBytes(deviceId))
	);
}

/** Compares in constant time so response timing doesn't leak how much matched. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
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

/** Reverses toBase64Url, also used for the PIN hashes. Throws on invalid input. */
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

/**
 * For keys and signatures arriving over the network: undefined unless the
 * value decodes to exactly `length` bytes, so bad input is a rejection rather
 * than an exception somewhere deeper in the handshake.
 */
export function decodeFixedLength(value: string, length: number): Uint8Array | undefined {
	try {
		const bytes = fromBase64Url(value);
		return bytes.length === length ? bytes : undefined;
	} catch {
		return undefined;
	}
}
