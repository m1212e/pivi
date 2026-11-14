// A small client for the OCI distribution API: exactly what pulling a base image
// and pushing an app image need, against any registry (Docker Hub, ghcr.io,
// GitLab, Gitea/Forgejo, a self-hosted registry:2).
import { createHash } from 'node:crypto';
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basicHeader, fetchToken, findCredentials, parseChallenge, type Credentials } from './auth';
import { apiHost, isLocal } from './reference';

const MANIFEST_TYPES = [
	'application/vnd.oci.image.index.v1+json',
	'application/vnd.oci.image.manifest.v1+json',
	'application/vnd.docker.distribution.manifest.list.v2+json',
	'application/vnd.docker.distribution.manifest.v2+json'
];

export type Fetched = { bytes: Buffer; mediaType: string; digest: string };

export const sha256 = (data: Buffer | string) =>
	`sha256:${createHash('sha256').update(data).digest('hex')}`;

/** Downloaded blobs, by digest, shared by every build on this machine. */
function blobCacheDir(): string {
	const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
	return join(base, 'pivi', 'blobs', 'sha256');
}

type RequestOptions = {
	scopes: string[];
	method?: string;
	headers?: Record<string, string>;
	body?: Buffer;
	/** Follow redirects ourselves: blob downloads redirect to storage that must not get our token. */
	redirect?: RequestRedirect;
};

export class RegistryClient {
	private readonly origin: string;
	private readonly credentials: Credentials | undefined;
	private readonly tokens = new Map<string, string>();

	constructor(
		readonly registry: string,
		credentials?: Credentials
	) {
		this.origin = `${isLocal(registry) ? 'http' : 'https'}://${apiHost(registry)}`;
		this.credentials = credentials ?? findCredentials(registry);
	}

	/** One request, authenticating as the registry asks on a 401 and retrying once. */
	async request(path: string, options: RequestOptions): Promise<Response> {
		const url = path.startsWith('http') ? path : `${this.origin}${path}`;
		const send = (authorization?: string) =>
			fetch(url, {
				method: options.method ?? 'GET',
				headers: { ...options.headers, ...(authorization ? { authorization } : {}) },
				body: options.body ? new Uint8Array(options.body) : undefined,
				redirect: options.redirect ?? 'follow',
				signal: AbortSignal.timeout(10 * 60_000)
			});
		const key = options.scopes.join(' ');
		const cached = this.tokens.get(key);
		const first = await send(cached);
		if (first.status !== 401) return first;
		await first.body?.cancel();
		const authorization = await this.authorize(
			first.headers.get('www-authenticate'),
			options.scopes
		);
		if (authorization.startsWith('Bearer ')) this.tokens.set(key, authorization);
		const second = await send(authorization);
		if (second.status === 401 || second.status === 403) {
			await second.body?.cancel();
			const who = this.credentials
				? `the credentials of ${this.credentials.username}`
				: 'anonymous access';
			throw new Error(`${this.registry} refused ${who} (HTTP ${second.status})`);
		}
		return second;
	}

	private async authorize(header: string | null, scopes: string[]): Promise<string> {
		const challenge = parseChallenge(header);
		if (challenge?.scheme === 'bearer') {
			return `Bearer ${await fetchToken(challenge, scopes, this.credentials)}`;
		}
		if (this.credentials) return basicHeader(this.credentials);
		throw new Error(
			`${this.registry} needs credentials: set PIVI_REGISTRY_USERNAME and PIVI_REGISTRY_PASSWORD, or docker login`
		);
	}

	async manifest(repository: string, reference: string): Promise<Fetched> {
		const response = await this.request(`/v2/${repository}/manifests/${reference}`, {
			scopes: [`repository:${repository}:pull`],
			headers: { accept: MANIFEST_TYPES.join(', ') }
		});
		if (!response.ok)
			throw new Error(`${this.registry}/${repository}:${reference}: HTTP ${response.status}`);
		const bytes = Buffer.from(await response.arrayBuffer());
		const digest = sha256(bytes);
		if (reference.startsWith('sha256:') && reference !== digest) {
			throw new Error(
				`${this.registry}/${repository}@${reference} answered with content of digest ${digest}`
			);
		}
		const mediaType = response.headers.get('content-type')?.split(';')[0] ?? '';
		return { bytes, mediaType: JSON.parse(bytes.toString('utf8')).mediaType ?? mediaType, digest };
	}

	/** A blob as bytes, for small ones (configs). */
	async blob(repository: string, digest: string): Promise<Buffer> {
		return readFileSync(await this.blobFile(repository, digest));
	}

	/** A blob in the local cache, downloaded and verified on first use. Returns its path. */
	async blobFile(repository: string, digest: string): Promise<string> {
		const path = join(blobCacheDir(), digest.slice('sha256:'.length));
		if (existsSync(path)) return path;
		const response = await this.request(`/v2/${repository}/blobs/${digest}`, {
			scopes: [`repository:${repository}:pull`]
		});
		if (!response.ok || !response.body) {
			throw new Error(`${this.registry}/${repository}: blob ${digest}: HTTP ${response.status}`);
		}
		mkdirSync(dirname(path), { recursive: true });
		const partial = `${path}.${process.pid}.partial`;
		const hash = createHash('sha256');
		const source = Readable.fromWeb(response.body as never);
		source.on('data', (chunk: Buffer) => hash.update(chunk));
		await pipeline(source, createWriteStream(partial));
		const actual = `sha256:${hash.digest('hex')}`;
		if (actual !== digest) {
			rmSync(partial, { force: true });
			throw new Error(`${this.registry}/${repository}: blob ${digest} arrived as ${actual}`);
		}
		renameSync(partial, path);
		return path;
	}

	async hasBlob(repository: string, digest: string): Promise<boolean> {
		const response = await this.request(`/v2/${repository}/blobs/${digest}`, {
			method: 'HEAD',
			scopes: [`repository:${repository}:pull,push`],
			redirect: 'manual'
		});
		return response.ok || (response.status >= 300 && response.status < 400);
	}

	/** Asks the registry to link a blob from another repository it already holds. False if it would not. */
	async mount(repository: string, digest: string, from: string): Promise<boolean> {
		const query = new URLSearchParams({ mount: digest, from });
		const response = await this.request(`/v2/${repository}/blobs/uploads/?${query}`, {
			method: 'POST',
			scopes: [`repository:${repository}:pull,push`, `repository:${from}:pull`],
			headers: { 'content-length': '0' }
		});
		await response.body?.cancel();
		return response.status === 201;
	}

	/** Uploads a blob in one request (POST for a session, PUT with the content). */
	async upload(repository: string, digest: string, data: Buffer): Promise<void> {
		const scopes = [`repository:${repository}:pull,push`];
		const start = await this.request(`/v2/${repository}/blobs/uploads/`, {
			method: 'POST',
			scopes,
			headers: { 'content-length': '0' }
		});
		await start.body?.cancel();
		const location = start.headers.get('location');
		if (start.status !== 202 || !location) {
			throw new Error(
				`${this.registry}/${repository}: could not start an upload (HTTP ${start.status})`
			);
		}
		const url = new URL(location, this.origin);
		url.searchParams.set('digest', digest);
		const put = await this.request(url.toString(), {
			method: 'PUT',
			scopes,
			headers: {
				'content-type': 'application/octet-stream',
				'content-length': String(data.length)
			},
			body: data
		});
		await put.body?.cancel();
		if (put.status !== 201) {
			throw new Error(
				`${this.registry}/${repository}: upload of ${digest} failed (HTTP ${put.status})`
			);
		}
	}

	async putManifest(
		repository: string,
		reference: string,
		bytes: Buffer,
		mediaType: string
	): Promise<void> {
		const response = await this.request(`/v2/${repository}/manifests/${reference}`, {
			method: 'PUT',
			scopes: [`repository:${repository}:pull,push`],
			headers: { 'content-type': mediaType },
			body: bytes
		});
		const text = await response.text();
		if (response.status !== 201) {
			throw new Error(
				`${this.registry}/${repository}:${reference}: manifest refused (HTTP ${response.status}) ${text.slice(0, 300)}`
			);
		}
	}
}
