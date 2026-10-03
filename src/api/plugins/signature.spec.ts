import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseImageRef } from '#lib/plugins/imageRef';
import type { PluginManifest } from '#lib/plugins/manifest';
import {
	FakeRegistry,
	generateSigningKey,
	publishPluginImage,
	sha256,
	signImage
} from './fixtures';
import { RegistryClient } from './registry';
import { parsePluginSigner, SignatureError, verifyImageSignature } from './signature';

const manifest: PluginManifest = {
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
	const digest = publishPluginImage(registry, 'acme/demo', '1.0', manifest);
	const ref = parseImageRef(`${registry.registry}/acme/demo:1.0`);
	return { key, digest, ref, client: new RegistryClient() };
};

describe('parsePluginSigner', () => {
	it('normalizes a key and derives a stable fingerprint', () => {
		const { publicKeyPem } = generateSigningKey();
		const first = parsePluginSigner(publicKeyPem);
		const second = parsePluginSigner(`\n  ${publicKeyPem}\n`);
		expect(first).toEqual(second);
		expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it('rejects things that are not public keys', () => {
		expect(() => parsePluginSigner('not a key')).toThrow(SignatureError);
	});

	it('refuses a private key outright', () => {
		const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		expect(() =>
			parsePluginSigner(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
		).toThrow(/private key/);
	});
});

describe('verifyImageSignature', () => {
	it('accepts an image signed by the key', async () => {
		const { key, digest, ref, client } = setup();
		signImage(registry, 'acme/demo', digest, key.privateKey);
		await expect(
			verifyImageSignature(ref, digest, parsePluginSigner(key.publicKeyPem), client)
		).resolves.toBeUndefined();
	});

	it('rejects an unsigned image', async () => {
		const { key, digest, ref, client } = setup();
		await expect(
			verifyImageSignature(ref, digest, parsePluginSigner(key.publicKeyPem), client)
		).rejects.toThrow(/no signature/);
	});

	it('rejects an image signed by a different key', async () => {
		const { digest, ref, client } = setup();
		signImage(registry, 'acme/demo', digest, generateSigningKey().privateKey);
		const trusted = parsePluginSigner(generateSigningKey().publicKeyPem);
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
			verifyImageSignature(ref, digest, parsePluginSigner(key.publicKeyPem), client)
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
			verifyImageSignature(ref, digest, parsePluginSigner(key.publicKeyPem), client)
		).rejects.toBeInstanceOf(SignatureError);
	});
});
