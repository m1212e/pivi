// Plugins are only run if their image was signed by a key the user trusts.
//
// The signature format is cosign's: for an image with digest `sha256:<hex>`,
// the signature lives in the same repository under the tag `sha256-<hex>.sig`,
// as an OCI manifest whose layers each hold a "simple signing" JSON payload
// (naming the digest that was signed) with the signature itself in an
// annotation. Publishing is `cosign sign --key cosign.key <image>`; the
// publisher gives users `cosign.pub`, which is what gets pinned at install.
//
// Only key-based signatures are verified. Keyless (certificate/OIDC identity)
// signatures would need a Fulcio chain and transparency-log verification and
// are deliberately not accepted rather than half-checked.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { ImageRef } from '#lib/plugins/imageRef';
import { RegistryClient } from './registry';

const SIGNATURE_LAYER_TYPE = 'application/vnd.dev.cosign.simplesigning.v1+json';
const SIGNATURE_ANNOTATION = 'dev.cosignproject.cosign/signature';

export class SignatureError extends Error {}

// What's stored for an installed plugin: the key its signature checked out
// against, and a fingerprint of it to show the user.
export type PluginSigner = { publicKeyPem: string; fingerprint: string };

function loadPublicKey(pem: string): KeyObject {
	// Node would derive a public key from a private one without complaint; a
	// private key pasted here is a mistake worth surfacing (and never kept).
	if (/PRIVATE KEY/.test(pem)) {
		throw new SignatureError('That is a private key — paste the public key (cosign.pub)');
	}
	try {
		const key = createPublicKey(pem);
		if (!['ec', 'rsa', 'ed25519'].includes(key.asymmetricKeyType ?? '')) {
			throw new Error(`unsupported key type ${key.asymmetricKeyType}`);
		}
		return key;
	} catch (error) {
		throw new SignatureError(
			`Not a usable public key: ${error instanceof Error ? error.message : error}`
		);
	}
}

// Normalizes a pasted PEM and computes the fingerprint the UI shows (SHA-256 of
// the key's DER encoding), so the same key always reads the same way.
export function parsePluginSigner(pem: string): PluginSigner {
	const key = loadPublicKey(pem.trim());
	const der = key.export({ type: 'spki', format: 'der' });
	return {
		publicKeyPem: key.export({ type: 'spki', format: 'pem' }).toString().trim(),
		fingerprint: createHash('sha256').update(der).digest('hex')
	};
}

const payloadSchema = z.object({
	critical: z.object({
		type: z.string(),
		image: z.object({ 'docker-manifest-digest': z.string() })
	})
});

function signatureMatches(key: KeyObject, payload: Uint8Array, signature: Buffer): boolean {
	// ed25519 signs the message directly; EC and RSA sign its SHA-256.
	const algorithm = key.asymmetricKeyType === 'ed25519' ? null : 'sha256';
	try {
		return verify(algorithm, payload, key, signature);
	} catch {
		return false;
	}
}

// Throws unless `digest` of `ref` carries a signature made by `signer`'s key.
export async function verifyImageSignature(
	ref: ImageRef,
	digest: string,
	signer: PluginSigner,
	client: RegistryClient = new RegistryClient()
): Promise<void> {
	const key = loadPublicKey(signer.publicKeyPem);
	const signatureTag = `${digest.replace(':', '-')}.sig`;

	let manifest;
	try {
		manifest = z
			.object({
				layers: z.array(
					z.object({
						mediaType: z.string(),
						digest: z.string(),
						annotations: z.record(z.string(), z.string()).optional()
					})
				)
			})
			.parse((await client.getManifest(ref, signatureTag)).json);
	} catch {
		throw new SignatureError('The image has no signature');
	}

	for (const layer of manifest.layers) {
		const encoded = layer.annotations?.[SIGNATURE_ANNOTATION];
		if (layer.mediaType !== SIGNATURE_LAYER_TYPE || !encoded) continue;

		const payloadBytes = await client.getBlob(ref, layer.digest);
		const signature = Buffer.from(encoded, 'base64');
		if (!signatureMatches(key, payloadBytes, signature)) continue;

		// The signature is genuine; make sure it was made over *this* image and
		// not some other one the same key signed.
		const payload = payloadSchema.safeParse(JSON.parse(new TextDecoder().decode(payloadBytes)));
		if (
			payload.success &&
			payload.data.critical.type === 'cosign container image signature' &&
			payload.data.critical.image['docker-manifest-digest'] === digest
		) {
			return;
		}
	}
	throw new SignatureError(`The image is not signed by key ${signer.fingerprint.slice(0, 16)}…`);
}
