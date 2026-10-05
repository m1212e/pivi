import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseImageRef } from '#lib/apps/imageRef';
import type { AppManifest } from '#lib/apps/manifest';
import { FakeRegistry, generateSigningKey, publishAppImage, sha256, signImage } from './fixtures';
import { RegistryClient } from './registry';
import { normalizePem, parseAppSigner, SignatureError, verifyImageSignature } from './signature';

const manifest: AppManifest = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: [],
	permissions: [],
	entryScreenId: 'main'
};

let registry: FakeRegistry;
beforeEach(async () => {
	registry = await new FakeRegistry().start();
});
afterEach(() => registry.stop());

const setup = () => {
	const key = generateSigningKey();
	const digest = publishAppImage(registry, 'acme/demo', '1.0', manifest);
	const ref = parseImageRef(`${registry.registry}/acme/demo:1.0`);
	return { key, digest, ref, client: new RegistryClient() };
};

describe('parseAppSigner', () => {
	it('normalizes a key and derives a stable fingerprint', () => {
		const { publicKeyPem } = generateSigningKey();
		const first = parseAppSigner(publicKeyPem);
		const second = parseAppSigner(`\n  ${publicKeyPem}\n`);
		expect(first).toEqual(second);
		expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it('rejects things that are not public keys', () => {
		expect(() => parseAppSigner('not a key')).toThrow(SignatureError);
		expect(() => parseAppSigner('not a key')).toThrow(/Paste the contents of cosign.pub/);
	});

	it('refuses a private key outright', () => {
		const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		expect(() =>
			parseAppSigner(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
		).toThrow(/private key/);
	});
});

describe('normalizePem', () => {
	it('restores the line breaks of a key that was typed into a single-line field', () => {
		const { publicKeyPem } = generateSigningKey();
		const flattened = publicKeyPem.replace(/\n/g, ' ');
		expect(normalizePem(flattened)).toBe(publicKeyPem.trim());
		expect(parseAppSigner(flattened)).toEqual(parseAppSigner(publicKeyPem));
	});

	it('also copes with the breaks being dropped entirely', () => {
		const { publicKeyPem } = generateSigningKey();
		const body = publicKeyPem.split('\n').slice(1, -2).join('');
		const squashed = `-----BEGIN PUBLIC KEY-----${body}-----END PUBLIC KEY-----`;
		expect(parseAppSigner(squashed)).toEqual(parseAppSigner(publicKeyPem));
	});

	it('leaves anything that is not a PEM block alone', () => {
		expect(normalizePem('  not a key ')).toBe('not a key');
	});
});

describe('verifyImageSignature', () => {
	it('accepts an image signed by the key', async () => {
		const { key, digest, ref, client } = setup();
		signImage(registry, 'acme/demo', digest, key.privateKey);
		await expect(
			verifyImageSignature(ref, digest, parseAppSigner(key.publicKeyPem), client)
		).resolves.toBeUndefined();
	});

	it('rejects an unsigned image', async () => {
		const { key, digest, ref, client } = setup();
		await expect(
			verifyImageSignature(ref, digest, parseAppSigner(key.publicKeyPem), client)
		).rejects.toThrow(/no signature/);
	});

	it('rejects an image signed by a different key', async () => {
		const { digest, ref, client } = setup();
		signImage(registry, 'acme/demo', digest, generateSigningKey().privateKey);
		const trusted = parseAppSigner(generateSigningKey().publicKeyPem);
		await expect(verifyImageSignature(ref, digest, trusted, client)).rejects.toThrow(
			/not signed by key/
		);
	});

	it('rejects a genuine signature that was made over a different image', async () => {
		const { key, digest, ref, client } = setup();
		// The key did sign something — just not this digest — and that signature has
		// been copied under this image's signature tag.
		signImage(registry, 'acme/demo', digest, key.privateKey, { signedDigest: sha256('other') });
		await expect(
			verifyImageSignature(ref, digest, parseAppSigner(key.publicKeyPem), client)
		).rejects.toThrow(/not signed by key/);
	});

	it('rejects a signature whose payload was altered after signing', async () => {
		const { key, digest, ref, client } = setup();
		signImage(registry, 'acme/demo', digest, key.privateKey);
		const tag = `manifests/${digest.replace(':', '-')}.sig`;
		const entry = registry.entries.get(`acme/demo/${tag}`)!;
		const signatureManifest = JSON.parse(new TextDecoder().decode(entry.body));
		// Point the layer at a different (self-consistent) payload, keeping the old signature.
		const forged = registry.putBlob(
			'acme/demo',
			JSON.stringify({
				critical: {
					type: 'cosign container image signature',
					image: { 'docker-manifest-digest': digest }
				},
				optional: { forged: true }
			})
		);
		signatureManifest.layers[0].digest = forged;
		registry.put('acme/demo', tag, JSON.stringify(signatureManifest));
		await expect(
			verifyImageSignature(ref, digest, parseAppSigner(key.publicKeyPem), client)
		).rejects.toBeInstanceOf(SignatureError);
	});
});
