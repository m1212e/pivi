import { describe, expect, it } from 'vitest';
import {
	createOpener,
	createSealer,
	decodeFixedLength,
	generateEphemeralKeypair,
	generateIdentityKeypair,
	handshakeTranscript,
	pairingTokenId,
	pairRequestProof,
	pairResponseProof,
	PUBLIC_KEY_BYTES,
	signHandshake,
	toBase64Url,
	utf8ToBytes,
	verifyHandshake
} from './pairing';

const key = new Uint8Array(32).fill(7);
const bytes = (text: string) => utf8ToBytes(text);

describe('session frames', () => {
	it('decrypts frames in the order they were sealed', () => {
		const seal = createSealer(key);
		const open = createOpener(key);
		const first = seal(bytes('one'));
		const second = seal(bytes('two'));
		expect(open(first)).toEqual(bytes('one'));
		expect(open(second)).toEqual(bytes('two'));
	});

	it('rejects a replayed frame', () => {
		const seal = createSealer(key);
		const open = createOpener(key);
		const frame = seal(bytes('select'));
		open(frame);
		expect(() => open(frame)).toThrow();
	});

	it('rejects frames out of order', () => {
		const seal = createSealer(key);
		const open = createOpener(key);
		seal(bytes('dropped'));
		expect(() => open(seal(bytes('next')))).toThrow();
	});
});

describe('handshake signatures', () => {
	const tv = generateIdentityKeypair();
	const phone = generateIdentityKeypair();
	const transcript = handshakeTranscript({
		phoneEphemeralPublicKey: generateEphemeralKeypair().publicKey,
		relayEphemeralPublicKey: generateEphemeralKeypair().publicKey,
		devicePublicKey: phone.publicKey,
		tvPublicKey: tv.publicKey,
		deviceId: 'device'
	});

	it('verifies a signature under the role it was made for', () => {
		const signature = signHandshake(tv.secretKey, 'tv', transcript);
		expect(verifyHandshake(tv.publicKey, 'tv', transcript, signature)).toBe(true);
	});

	// Matters if a device ever registered the TV's own public key as its key.
	it('never accepts the TV signature as the phone response', () => {
		const signature = signHandshake(tv.secretKey, 'tv', transcript);
		expect(verifyHandshake(tv.publicKey, 'phone', transcript, signature)).toBe(false);
	});
});

describe('pairing proofs', () => {
	const token = toBase64Url(new Uint8Array(32).fill(1));
	const device = generateIdentityKeypair().publicKey;

	it('identifies the token without revealing it', () => {
		expect(pairingTokenId(token)).not.toContain(token);
		expect(pairingTokenId(token)).toBe(pairingTokenId(token));
	});

	it('binds the request proof to the token and the device key', () => {
		const proof = pairRequestProof(token, device);
		expect(pairRequestProof(token, device)).toEqual(proof);
		expect(pairRequestProof('other', device)).not.toEqual(proof);
		expect(pairRequestProof(token, generateIdentityKeypair().publicKey)).not.toEqual(proof);
	});

	it('binds the response proof to the TV key it vouches for', () => {
		const tvKey = generateIdentityKeypair().publicKey;
		const proof = pairResponseProof(token, device, tvKey, 'id');
		expect(pairResponseProof(token, device, generateIdentityKeypair().publicKey, 'id')).not.toEqual(
			proof
		);
	});
});

describe('decodeFixedLength', () => {
	it('accepts exactly the expected length', () => {
		const value = toBase64Url(new Uint8Array(PUBLIC_KEY_BYTES));
		expect(decodeFixedLength(value, PUBLIC_KEY_BYTES)).toHaveLength(PUBLIC_KEY_BYTES);
	});

	it('rejects other lengths and invalid base64 without throwing', () => {
		expect(decodeFixedLength(toBase64Url(new Uint8Array(31)), PUBLIC_KEY_BYTES)).toBeUndefined();
		expect(decodeFixedLength('a!b', PUBLIC_KEY_BYTES)).toBeUndefined();
	});
});
