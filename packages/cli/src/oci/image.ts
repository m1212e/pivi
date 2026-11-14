// Builds a pivi app image without Docker: the base image's layers (Node on
// Alpine), untouched, plus one layer with the bundled app (/app/main.mjs), for
// every platform pivi runs on. The
// manifest travels as the dev.pivi.manifest config label, as the host expects.
import { MANIFEST_LABEL } from '@pivi/sdk/manifest';
import { RegistryClient, sha256, type Fetched } from './client';
import { formatReference, parseReference, type ImageRef } from './reference';
import { gzip, tar } from './tar';

const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const OCI_CONFIG = 'application/vnd.oci.image.config.v1+json';
const OCI_LAYER = 'application/vnd.oci.image.layer.v1.tar+gzip';

export type Platform = { os: 'linux'; architecture: 'amd64' | 'arm64' };
const DEFAULT_PLATFORMS: Platform[] = [
	{ os: 'linux', architecture: 'amd64' },
	{ os: 'linux', architecture: 'arm64' }
];
// Node's current LTS, pinned to its major so a rebuild never jumps to a new Node.
// Node trusts the sandbox's TLS interception through NODE_EXTRA_CA_CERTS, which
// microsandbox sets in every guest.
export const DEFAULT_BASE = 'node:26-alpine';

/** Where the bundle goes in the image, and what the entrypoint runs. */
const APP_FILE = 'app/main.mjs';

export type Descriptor = { mediaType: string; digest: string; size: number; platform?: Platform };
export type Blob = { mediaType: string; digest: string; bytes: Buffer };

const blob = (mediaType: string, value: object | Buffer): Blob => {
	const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
	return { mediaType, digest: sha256(bytes), bytes };
};
const describe = (b: Blob, extra: Partial<Descriptor> = {}): Descriptor => ({
	mediaType: b.mediaType,
	digest: b.digest,
	size: b.bytes.length,
	...extra
});

export type BuiltImage = {
	base: ImageRef;
	/** The base index (or manifest) digest the build used, for reproducing it. */
	baseDigest: string;
	index: Blob;
	/** Per platform: its manifest and config. */
	platforms: { platform: Platform; manifest: Blob; config: Blob }[];
	appLayer: Blob;
	/** The base's layers, still in the base registry. */
	baseLayers: Descriptor[];
};

export type BuildOptions = {
	bundle: Buffer;
	/** The validated manifest, written as the label. */
	manifestLabel: string;
	base?: string;
	platforms?: Platform[];
	baseClient?: RegistryClient;
};

type BaseManifest = { layers: Descriptor[]; config: Descriptor };
type BaseConfig = {
	config?: Record<string, unknown> & { Labels?: Record<string, string> | null };
	rootfs?: { type: string; diff_ids: string[] };
	history?: unknown[];
	[key: string]: unknown;
};

/** The base's manifest for each requested platform. A single-platform base only serves its own. */
function basePlatformManifests(
	client: RegistryClient,
	ref: ImageRef,
	root: Fetched,
	platforms: Platform[]
) {
	const parsed = JSON.parse(root.bytes.toString('utf8'));
	if (!parsed.manifests) {
		if (platforms.length > 1) {
			return Promise.reject(
				new Error(`${formatReference(ref)} is single-platform, pass --platform`)
			);
		}
		return Promise.resolve([{ platform: platforms[0]!, manifest: root }]);
	}
	return Promise.all(
		platforms.map(async (platform) => {
			const entry = (parsed.manifests as Descriptor[]).find(
				(m) => m.platform?.os === platform.os && m.platform?.architecture === platform.architecture
			);
			if (!entry)
				throw new Error(
					`${formatReference(ref)} has no ${platform.os}/${platform.architecture} image`
				);
			return { platform, manifest: await client.manifest(ref.repository, entry.digest) };
		})
	);
}

/** The base config with the app on top: entrypoint, working directory, label, one more layer. */
function appConfig(base: BaseConfig, layerDiffId: string, manifestLabel: string): BaseConfig {
	const config = { ...(base.config ?? {}) };
	config.Entrypoint = ['node', `/${APP_FILE}`];
	delete config.Cmd;
	config.WorkingDir = '/app';
	config.Labels = { ...(config.Labels ?? {}), [MANIFEST_LABEL]: manifestLabel };
	// No `created`: a timestamp would change the digest of every rebuild.
	const rest = { ...base };
	delete rest.created;
	return {
		...rest,
		config,
		rootfs: { type: 'layers', diff_ids: [...(base.rootfs?.diff_ids ?? []), layerDiffId] },
		history: [
			...(base.history ?? []),
			{ created_by: `pivi-app build: /${APP_FILE}`, comment: 'pivi app' }
		]
	};
}

export async function buildImage(options: BuildOptions): Promise<BuiltImage> {
	const base = parseReference(options.base ?? DEFAULT_BASE);
	const platforms = options.platforms ?? DEFAULT_PLATFORMS;
	const client = options.baseClient ?? new RegistryClient(base.registry);
	const root = await client.manifest(base.repository, base.digest ?? base.tag!);

	const layerTar = tar([{ path: 'app/' }, { path: APP_FILE, content: options.bundle }]);
	const appLayer = blob(OCI_LAYER, gzip(layerTar));
	const diffId = sha256(layerTar);

	const baseLayers = new Map<string, Descriptor>();
	const built = await Promise.all(
		(await basePlatformManifests(client, base, root, platforms)).map(
			async ({ platform, manifest }) => {
				const parsed = JSON.parse(manifest.bytes.toString('utf8')) as BaseManifest;
				for (const layer of parsed.layers) baseLayers.set(layer.digest, layer);
				const baseConfig = JSON.parse(
					(await client.blob(base.repository, parsed.config.digest)).toString('utf8')
				);
				const config = blob(OCI_CONFIG, appConfig(baseConfig, diffId, options.manifestLabel));
				const imageManifest = blob(OCI_MANIFEST, {
					schemaVersion: 2,
					mediaType: OCI_MANIFEST,
					config: describe(config),
					layers: [
						...parsed.layers.map(({ mediaType, digest, size }) => ({ mediaType, digest, size })),
						describe(appLayer)
					]
				});
				return { platform, manifest: imageManifest, config };
			}
		)
	);
	const index = blob(OCI_INDEX, {
		schemaVersion: 2,
		mediaType: OCI_INDEX,
		manifests: built.map((p) => describe(p.manifest, { platform: p.platform }))
	});
	return {
		base,
		baseDigest: root.digest,
		index,
		platforms: built,
		appLayer,
		baseLayers: [...baseLayers.values()]
	};
}
