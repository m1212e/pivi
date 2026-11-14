// Publishes a built image to any registry: blobs first (skipping what the
// registry already has, mounting base layers when it holds the base too), then
// the platform manifests, then the index under each tag.
import { readFileSync } from 'node:fs';
import { findPublishCredentials } from './auth';
import { RegistryClient } from './client';
import type { BuiltImage } from './image';
import { formatReference, type ImageRef } from './reference';

export type PushProgress = (message: string) => void;

export type PushOptions = {
	target: ImageRef;
	/** Extra tags for the same image, e.g. `latest`. */
	tags?: string[];
	client?: RegistryClient;
	baseClient?: RegistryClient;
	onProgress?: PushProgress;
};

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

async function pushBaseLayers(
	image: BuiltImage,
	target: ImageRef,
	client: RegistryClient,
	baseClient: RegistryClient,
	log: PushProgress
) {
	const sameRegistry = target.registry === image.base.registry;
	for (const layer of image.baseLayers) {
		if (await client.hasBlob(target.repository, layer.digest)) continue;
		if (
			sameRegistry &&
			(await client.mount(target.repository, layer.digest, image.base.repository))
		) {
			log(`mounted base layer ${layer.digest.slice(7, 19)} (${mb(layer.size)})`);
			continue;
		}
		const path = await baseClient.blobFile(image.base.repository, layer.digest);
		log(`uploading base layer ${layer.digest.slice(7, 19)} (${mb(layer.size)})`);
		await client.upload(target.repository, layer.digest, readFileSync(path));
	}
}

export async function pushImage(
	image: BuiltImage,
	options: PushOptions
): Promise<{ digest: string; references: string[] }> {
	const { target } = options;
	const log = options.onProgress ?? (() => {});
	const client =
		options.client ?? new RegistryClient(target.registry, findPublishCredentials(target.registry));
	const baseClient = options.baseClient ?? new RegistryClient(image.base.registry);

	await pushBaseLayers(image, target, client, baseClient, log);
	const own = [image.appLayer, ...image.platforms.map((p) => p.config)];
	for (const blob of own) {
		if (await client.hasBlob(target.repository, blob.digest)) continue;
		log(
			`uploading ${blob === image.appLayer ? 'app layer' : 'config'} ${blob.digest.slice(7, 19)} (${mb(blob.bytes.length)})`
		);
		await client.upload(target.repository, blob.digest, blob.bytes);
	}
	for (const { manifest } of image.platforms) {
		await client.putManifest(
			target.repository,
			manifest.digest,
			manifest.bytes,
			manifest.mediaType
		);
	}
	const tags = [...new Set([target.tag, ...(options.tags ?? [])].filter((t): t is string => !!t))];
	const references: string[] = [];
	for (const tag of tags.length ? tags : [image.index.digest]) {
		await client.putManifest(target.repository, tag, image.index.bytes, image.index.mediaType);
		references.push(formatReference({ ...target, tag, digest: undefined }));
	}
	return { digest: image.index.digest, references };
}
