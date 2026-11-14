// An in-memory OCI registry for the tests: manifests, blobs, uploads, cross-repository
// mounts and bearer-token auth, as far as pivi-app publish uses them. Pulls are
// anonymous; pushes need `user:pass` when `auth` is on.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const digestOf = (data: Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

export type FakeRegistry = {
	host: string;
	blobs: Map<string, Buffer>;
	manifests: Map<string, { bytes: Buffer; mediaType: string }>;
	/** Requests by kind, to check what a push did. */
	counts: { uploads: number; mounts: number };
	putBlob(repository: string, data: Buffer): string;
	putManifest(repository: string, reference: string, value: object, mediaType: string): string;
	close(): Promise<void>;
};

const read = (req: IncomingMessage) =>
	new Promise<Buffer>((resolve) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks)));
	});

export async function startFakeRegistry(options: { auth?: boolean } = {}): Promise<FakeRegistry> {
	const blobs = new Map<string, Buffer>(); // `${repo}@${digest}`
	const manifests = new Map<string, { bytes: Buffer; mediaType: string }>(); // `${repo}:${ref}`
	const uploads = new Map<string, string>(); // upload id -> repo
	const counts = { uploads: 0, mounts: 0 };
	let host = '';

	const authorized = (req: IncomingMessage, write: boolean) => {
		if (!options.auth) return true;
		const header = req.headers.authorization ?? '';
		return header === 'Bearer push-token' || (!write && header === 'Bearer pull-token');
	};

	const server: Server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://${host}`);
		const send = (status: number, body?: Buffer | string, headers: Record<string, string> = {}) => {
			res.writeHead(status, headers);
			res.end(body);
		};
		if (url.pathname === '/token') {
			const basic = req.headers.authorization;
			const wantsPush = url.searchParams.getAll('scope').some((s) => s.includes('push'));
			const good = basic === `Basic ${Buffer.from('user:pass').toString('base64')}`;
			if (wantsPush && !good) return send(401);
			return send(200, JSON.stringify({ token: good ? 'push-token' : 'pull-token' }));
		}
		const write = req.method !== 'GET' && req.method !== 'HEAD';
		if (!authorized(req, write)) {
			return send(401, '', {
				'www-authenticate': `Bearer realm="http://${host}/token",service="fake"`
			});
		}
		const match = url.pathname.match(/^\/v2\/(.+)\/(manifests|blobs)\/(.*)$/);
		if (!match) return send(404);
		const [, repo, kind, rest] = match as unknown as [string, string, string, string];

		if (kind === 'manifests') {
			if (req.method === 'PUT') {
				const bytes = await read(req);
				const mediaType = req.headers['content-type'] ?? '';
				manifests.set(`${repo}:${rest}`, { bytes, mediaType });
				manifests.set(`${repo}:${digestOf(bytes)}`, { bytes, mediaType });
				return send(201);
			}
			const found = manifests.get(`${repo}:${rest}`);
			return found
				? send(200, req.method === 'HEAD' ? '' : found.bytes, { 'content-type': found.mediaType })
				: send(404);
		}
		if (rest.startsWith('uploads/')) {
			const id = rest.slice('uploads/'.length);
			if (req.method === 'POST') {
				const mount = url.searchParams.get('mount');
				const from = url.searchParams.get('from');
				if (mount && from && blobs.has(`${from}@${mount}`)) {
					blobs.set(`${repo}@${mount}`, blobs.get(`${from}@${mount}`)!);
					counts.mounts++;
					return send(201);
				}
				const uploadId = String(uploads.size + 1);
				uploads.set(uploadId, repo);
				return send(202, '', { location: `/v2/${repo}/blobs/uploads/${uploadId}` });
			}
			if (req.method === 'PUT' && uploads.has(id)) {
				const data = await read(req);
				const digest = url.searchParams.get('digest');
				if (digest !== digestOf(data)) return send(400);
				blobs.set(`${repo}@${digest}`, data);
				counts.uploads++;
				return send(201);
			}
			return send(404);
		}
		const blob = blobs.get(`${repo}@${rest}`);
		return blob ? send(200, req.method === 'HEAD' ? '' : blob) : send(404);
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	host = `localhost:${(server.address() as AddressInfo).port}`;

	return {
		host,
		blobs,
		manifests,
		counts,
		putBlob(repository, data) {
			const digest = digestOf(data);
			blobs.set(`${repository}@${digest}`, data);
			return digest;
		},
		putManifest(repository, reference, value, mediaType) {
			const bytes = Buffer.from(JSON.stringify(value));
			manifests.set(`${repository}:${reference}`, { bytes, mediaType });
			manifests.set(`${repository}:${digestOf(bytes)}`, { bytes, mediaType });
			return digestOf(bytes);
		},
		close: () => new Promise<void>((done) => server.close(() => done()))
	};
}

/** A two-platform base image (one tiny layer each) in `repository:tag`. */
export function seedBaseImage(registry: FakeRegistry, repository = 'base/bun', tag = '1') {
	const index: { mediaType: string; digest: string; size: number; platform: object }[] = [];
	for (const architecture of ['amd64', 'arm64']) {
		const layer = Buffer.from(`layer for ${architecture}`);
		const layerDigest = registry.putBlob(repository, layer);
		const config = Buffer.from(
			JSON.stringify({
				architecture,
				os: 'linux',
				created: '2026-01-01T00:00:00Z',
				config: { Entrypoint: ['/entry.sh'], Cmd: ['bun'], Labels: { base: 'yes' } },
				rootfs: { type: 'layers', diff_ids: [`sha256:${'0'.repeat(64)}`] },
				history: [{ created_by: 'base' }]
			})
		);
		const configDigest = registry.putBlob(repository, config);
		const manifest = {
			schemaVersion: 2,
			mediaType: 'application/vnd.oci.image.manifest.v1+json',
			config: {
				mediaType: 'application/vnd.oci.image.config.v1+json',
				digest: configDigest,
				size: config.length
			},
			layers: [
				{
					mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
					digest: layerDigest,
					size: layer.length
				}
			]
		};
		const digest = registry.putManifest(
			repository,
			`m-${architecture}`,
			manifest,
			manifest.mediaType
		);
		const size = Buffer.byteLength(JSON.stringify(manifest));
		index.push({
			mediaType: manifest.mediaType,
			digest,
			size,
			platform: { os: 'linux', architecture }
		});
	}
	registry.putManifest(
		repository,
		tag,
		{ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: index },
		'application/vnd.oci.image.index.v1+json'
	);
	return `${registry.host}/${repository}:${tag}`;
}
