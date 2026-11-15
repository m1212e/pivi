// Signs published images with skopeo, in cosign's key-based format: the signature
// is stored next to the image under the tag `sha256-<digest>.sig`, which is what
// the pivi host verifies against the public key a user pastes at install. The key
// pair comes from `pivi-app keygen` (skopeo generate-sigstore-key); a key made by
// `cosign generate-key-pair` works too.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Credentials } from './builder';
import { isLocalRegistry, type ImageRef } from '@pivi/sdk/image';

function skopeo(args: string[]) {
	// stdin stays the terminal for a passphrase prompt, the output goes to stderr (see builder.ts).
	const result = spawnSync('skopeo', args, { stdio: ['inherit', 2, 2], encoding: 'utf8' });
	if (result.error) {
		throw new Error(
			'Signing needs skopeo (it comes with buildah and podman on most systems): install it'
		);
	}
	if (result.status !== 0)
		throw new Error(
			`skopeo ${args[0]} failed (exit ${result.status}) ${result.stderr ?? ''}`.trim()
		);
}

/** A key given as a path, or as its PEM content (a CI secret). */
export type SigningKey = { key: string; passphrase?: string };

export function signingKeyFromEnv(flag: string | undefined): SigningKey | undefined {
	const key = flag ?? process.env.PIVI_SIGNING_KEY;
	return key ? { key, passphrase: process.env.PIVI_SIGNING_PASSPHRASE } : undefined;
}

/** Creates `<prefix>.private` (keep it secret) and `<prefix>.pub` (give it to users). */
export function generateKeyPair(prefix: string, passphrase?: string) {
	const dir = mkdtempSync(join(tmpdir(), 'pivi-keygen-'));
	try {
		const args = ['generate-sigstore-key', '--output-prefix', resolve(prefix)];
		if (passphrase !== undefined) {
			writeFileSync(join(dir, 'pass'), passphrase, { mode: 0o600 });
			args.push('--passphrase-file', join(dir, 'pass'));
		}
		skopeo(args);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Signs the image `target` points at (the manifest list and every platform image). */
export function signImage(target: ImageRef, signing: SigningKey, credentials?: Credentials) {
	const dir = mkdtempSync(join(tmpdir(), 'pivi-sign-'));
	try {
		let keyFile = signing.key;
		if (signing.key.includes('-----BEGIN')) {
			keyFile = join(dir, 'key.private');
			writeFileSync(keyFile, signing.key, { mode: 0o600 });
		}
		// Store the signatures as cosign does, next to the image, for this registry only.
		mkdirRegistries(dir, target.registry);
		const image = `docker://${target.registry}/${target.repository}:${target.tag}`;
		const insecure = isLocalRegistry(target.registry)
			? ['--src-tls-verify=false', '--dest-tls-verify=false']
			: [];
		const creds = credentials
			? [
					'--src-creds',
					`${credentials.username}:${credentials.password}`,
					'--dest-creds',
					`${credentials.username}:${credentials.password}`
				]
			: [];
		const passphrase: string[] = [];
		if (signing.passphrase !== undefined) {
			writeFileSync(join(dir, 'pass'), signing.passphrase, { mode: 0o600 });
			passphrase.push('--sign-passphrase-file', join(dir, 'pass'));
		}
		// Copying the image onto itself (digests preserved) is how skopeo attaches signatures.
		skopeo([
			'copy',
			'--all',
			'--preserve-digests',
			'--registries.d',
			join(dir, 'registries.d'),
			'--sign-by-sigstore-private-key',
			keyFile,
			...passphrase,
			...insecure,
			...creds,
			image,
			image
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function mkdirRegistries(dir: string, registry: string) {
	const registries = join(dir, 'registries.d');
	mkdirSync(registries, { recursive: true });
	writeFileSync(
		join(registries, 'pivi.yaml'),
		`docker:\n  ${registry}:\n    use-sigstore-attachments: true\n`
	);
}
