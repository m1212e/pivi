// Talks to an OCI registry's HTTP API (distribution spec) just far enough to
// answer "what is this plugin?" without pulling it: resolve a tag to a digest,
// pick the right platform out of a multi-arch index, and read the plugin
// manifest out of the image config's labels. Pulling the layers is the
// sandbox's job once the user has accepted what's being asked for.
//
// A registry is only trusted to be a transport. Every manifest and blob that
// comes back is hashed and compared against the digest it was requested by
// (or, for a tag, the digest becomes the thing that's pinned), so a registry or
// a man in the middle can't hand over something other than what was named.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { formatImageRef, registryApiHost, type ImageRef } from '#lib/plugins/imageRef';
import { MANIFEST_LABEL, pluginManifestSchema, type PluginManifest } from '#lib/plugins/manifest';
import { SUPPORTED_PROTOCOLS } from '#lib/plugins/host';

const MAX_MANIFEST_BYTES = 4 << 20;
const MAX_BLOB_BYTES = 4 << 20;

const MANIFEST_TYPES = [
	'application/vnd.oci.image.index.v1+json',
	'application/vnd.oci.image.manifest.v1+json',
	'application/vnd.docker.distribution.manifest.list.v2+json',
	'application/vnd.docker.distribution.manifest.v2+json'
];

export class RegistryError extends Error {}

export type Platform = { os: 'linux'; architecture: 'amd64' | 'arm64' };

function hostPlatform(): Platform {
	return { os: 'linux', architecture: process.arch === 'arm64' ? 'arm64' : 'amd64' };
}

function sha256Digest(bytes: Uint8Array): string {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// A registry on this machine is spoken to in plain HTTP (how a development
// registry is normally run); everything else is HTTPS only.
export function isLocalRegistry(registry: string): boolean {
	const host = registry.replace(/:\d+$/, '');
	return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function schemeFor(registry: string): 'http' | 'https' {
	return isLocalRegistry(registry) ? 'http' : 'https';
}

type Challenge = { realm: string; service?: string; scope?: string };

function parseBearerChallenge(header: string | null): Challenge | null {
	if (!header || !/^bearer\s/i.test(header)) return null;
	const fields = Object.fromEntries(
		[...header.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value])
	);
	return fields.realm
		? { realm: fields.realm, service: fields.service, scope: fields.scope }
		: null;
}

// What a failed connection looks like to the person reading it: the network
// error itself ("fetch failed") says nothing about which registry or why.
function unreachable(registry: string): never {
	throw new RegistryError(`Could not reach the registry ${registry}`);
}

export type RegistryManifest = {
	digest: string;
	mediaType: string;
	json: unknown;
};

const descriptorSchema = z.object({
	digest: z.string(),
	mediaType: z.string().optional(),
	platform: z.object({ os: z.string(), architecture: z.string() }).optional()
});
const indexSchema = z.object({ manifests: z.array(descriptorSchema) });
const imageManifestSchema = z.object({
	config: descriptorSchema,
	layers: z
		.array(
			descriptorSchema.extend({
				annotations: z.record(z.string(), z.string()).optional()
			})
		)
		.default([])
});
type ImageManifest = z.infer<typeof imageManifestSchema>;

export class RegistryClient {
	// Anonymous pull tokens, per registry and scope. Short-lived and cheap to
	// refetch, so no expiry handling: a stale one just earns a fresh challenge.
	private readonly tokens = new Map<string, string>();

	constructor(private readonly fetchImpl: typeof fetch = fetch) {}

	private url(ref: ImageRef, path: string): string {
		return `${schemeFor(ref.registry)}://${registryApiHost(ref.registry)}/v2/${ref.repository}/${path}`;
	}

	private async authorize(challenge: Challenge, cacheKey: string): Promise<string> {
		const url = new URL(challenge.realm);
		if (challenge.service) url.searchParams.set('service', challenge.service);
		if (challenge.scope) url.searchParams.set('scope', challenge.scope);

		const response = await this.fetchImpl(url).catch(() => unreachable(url.host));
		if (!response.ok) throw new RegistryError(`Registry denied access (${response.status})`);
		const body = z
			.object({ token: z.string().optional(), access_token: z.string().optional() })
			.parse(await response.json());
		const token = body.token ?? body.access_token;
		if (!token) throw new RegistryError('Registry returned no token');
		this.tokens.set(cacheKey, token);
		return token;
	}

	private async request(ref: ImageRef, path: string, accept?: string): Promise<Response> {
		const url = this.url(ref, path);
		const cacheKey = `${ref.registry}/${ref.repository}`;
		const send = (token?: string) =>
			this.fetchImpl(url, {
				headers: {
					...(accept ? { Accept: accept } : {}),
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				redirect: 'follow'
			});

		let response = await send(this.tokens.get(cacheKey)).catch(() => unreachable(ref.registry));
		if (response.status === 401) {
			const challenge = parseBearerChallenge(response.headers.get('www-authenticate'));
			if (!challenge) throw new RegistryError(`${ref.registry} requires authentication`);
			response = await send(await this.authorize(challenge, cacheKey)).catch(() =>
				unreachable(ref.registry)
			);
		}
		if (response.status === 404) {
			throw new RegistryError(`Not found: ${formatImageRef(ref)} (${path})`);
		}
		if (!response.ok) throw new RegistryError(`Registry error ${response.status} for ${path}`);
		return response;
	}

	private async readBounded(response: Response, limit: number): Promise<Uint8Array> {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.length > limit) throw new RegistryError(`Response exceeds ${limit} bytes`);
		return bytes;
	}

	// `reference` is a tag or a digest. For a digest, the body has to hash to it.
	async getManifest(ref: ImageRef, reference: string): Promise<RegistryManifest> {
		const response = await this.request(ref, `manifests/${reference}`, MANIFEST_TYPES.join(','));
		const bytes = await this.readBounded(response, MAX_MANIFEST_BYTES);
		const digest = sha256Digest(bytes);

		if (reference.startsWith('sha256:') && digest !== reference) {
			throw new RegistryError(`Manifest digest mismatch for ${reference}`);
		}
		return {
			digest,
			mediaType: response.headers.get('content-type')?.split(';')[0] ?? '',
			json: JSON.parse(new TextDecoder().decode(bytes))
		};
	}

	// Always checked against its digest: a blob's name *is* its hash.
	async getBlob(ref: ImageRef, digest: string): Promise<Uint8Array> {
		const response = await this.request(ref, `blobs/${digest}`);
		const bytes = await this.readBounded(response, MAX_BLOB_BYTES);
		if (sha256Digest(bytes) !== digest) {
			throw new RegistryError(`Blob digest mismatch for ${digest}`);
		}
		return bytes;
	}
}

// Only the parts of an image config the host needs.
const imageConfigSchema = z.object({
	config: z
		.object({
			Entrypoint: z.array(z.string()).nullish(),
			Cmd: z.array(z.string()).nullish(),
			WorkingDir: z.string().nullish(),
			Labels: z.record(z.string(), z.string()).nullish()
		})
		.default({})
});

export type ResolvedImage = {
	ref: ImageRef;
	// What the reference resolved to at the top level (the index for a
	// multi-arch image) — the thing that gets pinned, and that a signature
	// covers.
	digest: string;
	manifest: PluginManifest;
	// What to run: the image's ENTRYPOINT followed by its CMD, as Docker does.
	command: string[];
	workingDir?: string;
};

async function selectPlatformManifest(
	client: RegistryClient,
	ref: ImageRef,
	root: RegistryManifest,
	platform: Platform
): Promise<ImageManifest> {
	const index = indexSchema.safeParse(root.json);
	if (!index.success) return imageManifestSchema.parse(root.json);

	const match = index.data.manifests.find(
		(m) => m.platform?.os === platform.os && m.platform?.architecture === platform.architecture
	);
	if (!match) {
		throw new RegistryError(
			`No ${platform.os}/${platform.architecture} build of ${formatImageRef(ref)} was published`
		);
	}
	return imageManifestSchema.parse((await client.getManifest(ref, match.digest)).json);
}

// Resolves an image reference to what the host needs to show it for approval
// and later run it, reading nothing but manifests and the config blob.
export async function resolveImage(
	ref: ImageRef,
	client: RegistryClient = new RegistryClient(),
	platform: Platform = hostPlatform()
): Promise<ResolvedImage> {
	const root = await client.getManifest(ref, ref.digest ?? ref.tag ?? 'latest');
	const imageManifest = await selectPlatformManifest(client, ref, root, platform);
	const config = imageConfigSchema.parse(
		JSON.parse(new TextDecoder().decode(await client.getBlob(ref, imageManifest.config.digest)))
	).config;

	const label = config.Labels?.[MANIFEST_LABEL];
	if (!label)
		throw new RegistryError(`Not a pivi plugin: the image has no ${MANIFEST_LABEL} label`);

	let manifest: PluginManifest;
	try {
		manifest = pluginManifestSchema.parse(JSON.parse(label));
	} catch (error) {
		throw new RegistryError(
			`Invalid plugin manifest: ${error instanceof Error ? error.message : error}`
		);
	}
	if (!SUPPORTED_PROTOCOLS.includes(manifest.protocol)) {
		throw new RegistryError(`Unsupported plugin protocol version ${manifest.protocol}`);
	}

	const command = [...(config.Entrypoint ?? []), ...(config.Cmd ?? [])];
	if (command.length === 0) throw new RegistryError('The image has no ENTRYPOINT or CMD to run');

	return {
		ref,
		digest: root.digest,
		manifest,
		command,
		workingDir: config.WorkingDir || undefined
	};
}

// The reference to hand the sandbox to pull: pinned to the digest that was
// verified, never the mutable tag.
export function pinnedReference(ref: ImageRef, digest: string): string {
	return formatImageRef({ registry: ref.registry, repository: ref.repository, digest });
}
