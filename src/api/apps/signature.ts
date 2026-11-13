// Proves an app image (and every later update) comes from the publisher whose
// key the user pasted at install, so whoever controls the registry tag can't
// swap in other code. The user may skip this at install for unsigned images.
//
// The signature format is cosign's: for an image with digest `sha256:<hex>`,
// the signature lives in the same repository under the tag `sha256-<hex>.sig`,
// as an OCI manifest whose layers each hold a "simple signing" JSON payload
// (naming the digest that was signed) with the signature itself in an
// annotation. Publishing is `cosign sign --key cosign.key <image>`, and the
// publisher gives users `cosign.pub`, which is what gets pinned at install.
//
// Only key-based signatures are verified. Keyless (certificate/OIDC identity)
// signatures would need a Fulcio chain and transparency-log verification and
// are deliberately not accepted rather than half-checked.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { ImageRef } from '#lib/apps/imageRef';
import { RegistryClient } from './registry';

const SIGNATURE_LAYER_TYPE = 'application/vnd.dev.cosign.simplesigning.v1+json';
const SIGNATURE_ANNOTATION = 'dev.cosignproject.cosign/signature';

/** Marks errors whose message the install form shows the user as is. */
export class SignatureError extends Error {}

/**
 * The key an app was installed with, stored on its row (db/schema.ts) so
 * updater.ts can demand the same signer for every update. The fingerprint is
 * what the install preview shows.
 */
export type AppSigner = { publicKeyPem: string; fingerprint: string };

// Turns OpenSSL's cryptic failures into messages the person pasting the key can act on.
function loadPublicKey(pem: string): KeyObject {
	// Node would derive a public key from a private one without complaint, but a
	// private key pasted here is a mistake worth surfacing (and never kept).
	if (/PRIVATE KEY/.test(pem)) {
		throw new SignatureError('That is a private key — paste the public key (cosign.pub)');
	}
	let key: KeyObject;
	try {
		key = createPublicKey(pem);
	} catch {
		// OpenSSL's own message ("DECODER routines::unsupported") means nothing to
		// the person who pasted the wrong thing.
		throw new SignatureError(
			'That is not a public key. Paste the contents of cosign.pub, starting with -----BEGIN PUBLIC KEY-----'
		);
	}
	if (!['ec', 'rsa', 'ed25519'].includes(key.asymmetricKeyType ?? '')) {
		throw new SignatureError(`Unsupported key type: ${key.asymmetricKeyType}`);
	}
	return key;
}

/**
 * A key pasted into the install form's single-line field loses its line breaks,
 * which OpenSSL won't read, so parseAppSigner rebuilds the standard PEM layout first.
 */
export function normalizePem(text: string): string {
	const match = text.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
	if (!match) return text.trim();

	const body = match[2].replace(/\s+/g, '');
	const lines = body.match(/.{1,64}/g) ?? [];
	return [`-----BEGIN ${match[1]}-----`, ...lines, `-----END ${match[1]}-----`].join('\n');
}

/**
 * Turns the key pasted at install (installer.ts) into what's stored and shown.
 * The fingerprint hashes the DER encoding, so the same key always reads the same.
 */
export function parseAppSigner(pem: string): AppSigner {
	const key = loadPublicKey(normalizePem(pem));
	const der = key.export({ type: 'spki', format: 'der' });
	return {
		publicKeyPem: key.export({ type: 'spki', format: 'pem' }).toString().trim(),
		fingerprint: createHash('sha256').update(der).digest('hex')
	};
}

// The cosign payload names the digest that was signed. Checking it stops a
// signature made for another image from being replayed here.
const payloadSchema = z.object({
	critical: z.object({
		type: z.string(),
		image: z.object({ 'docker-manifest-digest': z.string() })
	})
});

function signatureMatches(key: KeyObject, payload: Uint8Array, signature: Buffer): boolean {
	// ed25519 signs the message directly, EC and RSA sign its SHA-256.
	const algorithm = key.asymmetricKeyType === 'ed25519' ? null : 'sha256';
	try {
		return verify(algorithm, payload, key, signature);
	} catch {
		return false;
	}
}

/**
 * Gate used (through AppDeps.verify) before installing an image or accepting
 * an update for it. Throws unless `digest` carries a signature by `signer`'s key.
 */
export async function verifyImageSignature(
	ref: ImageRef,
	digest: string,
	signer: AppSigner,
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

		// The signature is genuine, so make sure it was made over *this* image and
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
