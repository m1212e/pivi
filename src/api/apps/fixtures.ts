// Fixtures for the app tests: a tiny in-memory OCI registry for tests: serves manifests, blobs and
// (optionally) a bearer-token challenge over a real local HTTP server, so the
// registry client and signature code are exercised through actual requests.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { InstalledApp, NewInstalledApp, AppStore } from './store';

export const sha256 = (data: Uint8Array | string) =>
	`sha256:${createHash('sha256').update(data).digest('hex')}`;

type Entry = { body: Uint8Array; contentType: string };

export class FakeRegistry {
	readonly entries = new Map<string, Entry>();
	requireToken = false;
	requests: string[] = [];
	private server?: Server;
	port = 0;

	get registry(): string {
		return `localhost:${this.port}`;
	}

	// Stores a document under a path like `manifests/<tag or digest>` or `blobs/<digest>`.
	put(repo: string, path: string, body: Uint8Array | string, contentType = 'application/json') {
		const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
		this.entries.set(`${repo}/${path}`, { body: bytes, contentType });
		return sha256(bytes);
	}

	// Stores a manifest under its digest and, when given, a tag too.
	putManifest(repo: string, manifest: unknown, tag?: string, contentType?: string) {
		const body = JSON.stringify(manifest);
		const type = contentType ?? 'application/vnd.oci.image.manifest.v1+json';
		const digest = this.put(repo, `manifests/${sha256(body)}`, body, type);
		if (tag) this.put(repo, `manifests/${tag}`, body, type);
		return digest;
	}

	putBlob(repo: string, body: Uint8Array | string) {
		const digest = sha256(typeof body === 'string' ? new TextEncoder().encode(body) : body);
		this.put(repo, `blobs/${digest}`, body, 'application/octet-stream');
		return digest;
	}

	async start() {
		this.server = createServer((req, res) => {
			const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
			this.requests.push(url.pathname);

			if (url.pathname === '/token') {
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ token: 'test-token' }));
				return;
			}
			if (this.requireToken && req.headers.authorization !== 'Bearer test-token') {
				res.statusCode = 401;
				res.setHeader(
					'www-authenticate',
					`Bearer realm="http://localhost:${this.port}/token",service="fake",scope="repository:x:pull"`
				);
				res.end();
				return;
			}

			const match = url.pathname.match(/^\/v2\/(.+?)\/(manifests|blobs)\/(.+)$/);
			const entry = match && this.entries.get(`${match[1]}/${match[2]}/${match[3]}`);
			if (!entry) {
				res.statusCode = 404;
				res.end();
				return;
			}
			res.setHeader('content-type', entry.contentType);
			res.end(entry.body);
		});
		await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
		this.port = (this.server.address() as { port: number }).port;
		return this;
	}

	async stop() {
		await new Promise((resolve) => this.server?.close(resolve));
	}
}

// --- Publishing test fixtures

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { MANIFEST_LABEL, type AppManifest } from '#lib/apps/manifest';

export function generateSigningKey() {
	const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
	return {
		privateKey,
		publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
	};
}

// Publishes a one-platform app image under `tag` and returns its digest.
export function publishAppImage(
	registry: FakeRegistry,
	repo: string,
	tag: string,
	manifest: AppManifest | string,
	options: { command?: string[]; label?: string | null; architecture?: string } = {}
): string {
	const config = {
		architecture: options.architecture ?? 'amd64',
		os: 'linux',
		config: {
			Entrypoint: options.command ?? ['/app'],
			WorkingDir: '/app',
			Labels:
				options.label === null
					? {}
					: { [MANIFEST_LABEL]: options.label ?? JSON.stringify(manifest) }
		}
	};
	const configJson = JSON.stringify(config);
	const imageManifest = {
		schemaVersion: 2,
		mediaType: 'application/vnd.oci.image.manifest.v1+json',
		config: {
			mediaType: 'application/vnd.oci.image.config.v1+json',
			digest: registry.putBlob(repo, configJson),
			size: configJson.length
		},
		layers: []
	};
	return registry.putManifest(repo, imageManifest, tag);
}

// Publishes cosign's signature artifact for `digest`, the way `cosign sign --key` does.
export function signImage(
	registry: FakeRegistry,
	repo: string,
	digest: string,
	privateKey: KeyObject,
	options: { signedDigest?: string } = {}
) {
	const payload = JSON.stringify({
		critical: {
			identity: { 'docker-reference': `${registry.registry}/${repo}` },
			image: { 'docker-manifest-digest': options.signedDigest ?? digest },
			type: 'cosign container image signature'
		},
		optional: null
	});
	const payloadDigest = registry.putBlob(repo, payload);
	const signature = sign('sha256', Buffer.from(payload), privateKey).toString('base64');
	const signatureManifest = {
		schemaVersion: 2,
		mediaType: 'application/vnd.oci.image.manifest.v1+json',
		config: {
			mediaType: 'application/vnd.oci.image.config.v1+json',
			digest: payloadDigest,
			size: 0
		},
		layers: [
			{
				mediaType: 'application/vnd.dev.cosign.simplesigning.v1+json',
				digest: payloadDigest,
				size: payload.length,
				annotations: { 'dev.cosignproject.cosign/signature': signature }
			}
		]
	};
	registry.putManifest(repo, signatureManifest, `${digest.replace(':', '-')}.sig`);
}

// The installed-app table, in memory.
export function memoryStore(): AppStore {
	const rows = new Map<string, InstalledApp>();
	const now = new Date();
	return {
		list: () => Promise.resolve([...rows.values()]),
		find: (id) => Promise.resolve(rows.get(id)),
		insert: (row: NewInstalledApp) => {
			rows.set(row.appId, {
				id: row.appId,
				createdAt: now,
				updatedAt: now,
				ignoredDigest: null,
				pendingUpdate: null,
				lastCheckedAt: null,
				lastError: null,
				imageWorkingDir: null,
				...row
			} as InstalledApp);
			return Promise.resolve();
		},
		update: (id, patch) => {
			rows.set(id, { ...rows.get(id)!, ...patch } as InstalledApp);
			return Promise.resolve();
		},
		remove: (id) => {
			rows.delete(id);
			return Promise.resolve();
		}
	};
}
