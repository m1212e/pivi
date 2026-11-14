// Writes a built image as an OCI image layout directory, complete with the
// base layers, for inspecting it or handing it to other tools (skopeo, oras,
// `docker load` of a tar of it).
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RegistryClient } from './client';
import type { BuiltImage } from './image';

export async function writeLayout(
	image: BuiltImage,
	dir: string,
	ref: string,
	baseClient?: RegistryClient
) {
	const client = baseClient ?? new RegistryClient(image.base.registry);
	rmSync(dir, { recursive: true, force: true });
	const blobs = join(dir, 'blobs', 'sha256');
	mkdirSync(blobs, { recursive: true });
	const write = (digest: string, bytes: Buffer) =>
		writeFileSync(join(blobs, digest.slice(7)), bytes);

	for (const layer of image.baseLayers) {
		const target = join(blobs, layer.digest.slice(7));
		if (!existsSync(target))
			copyFileSync(await client.blobFile(image.base.repository, layer.digest), target);
	}
	write(image.appLayer.digest, image.appLayer.bytes);
	for (const { manifest, config } of image.platforms) {
		write(manifest.digest, manifest.bytes);
		write(config.digest, config.bytes);
	}
	write(image.index.digest, image.index.bytes);

	writeFileSync(join(dir, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
	writeFileSync(
		join(dir, 'index.json'),
		JSON.stringify({
			schemaVersion: 2,
			mediaType: 'application/vnd.oci.image.index.v1+json',
			manifests: [
				{
					mediaType: image.index.mediaType,
					digest: image.index.digest,
					size: image.index.bytes.length,
					annotations: { 'org.opencontainers.image.ref.name': ref }
				}
			]
		})
	);
}
