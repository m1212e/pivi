import { join, resolve } from 'node:path';
import { bundleApp } from '../bundle';
import { findPublishCredentials } from '../oci/auth';
import { RegistryClient } from '../oci/client';
import { buildImage, DEFAULT_BASE, type BuiltImage, type Platform } from '../oci/image';
import { writeLayout } from '../oci/layout';
import { pushImage } from '../oci/push';
import { formatReference, parseReference } from '../oci/reference';
import { readManifest } from '../project';
import { checkProject } from '../staticChecks';

export type ImageOptions = {
	entry?: string;
	base?: string;
	platforms?: Platform[];
	conditions?: string[];
};

export function parsePlatforms(value: string | undefined): Platform[] | undefined {
	if (!value) return undefined;
	return value.split(',').map((item) => {
		const [os, architecture] = item.trim().split('/');
		if (os !== 'linux' || (architecture !== 'amd64' && architecture !== 'arm64')) {
			throw new Error(`Unsupported platform "${item}": pivi runs linux/amd64 and linux/arm64`);
		}
		return { os, architecture };
	});
}

/** Validates the app (an image the host would refuse is not worth building), bundles it and assembles the image. */
async function assemble(
	dir: string,
	options: ImageOptions,
	baseClient?: RegistryClient
): Promise<{ image: BuiltImage; id: string; version: string }> {
	const errors = checkProject(dir, options.entry).filter((f) => f.level === 'error');
	if (errors.length)
		throw new Error(`The app is not valid:\n  ${errors.map((e) => e.message).join('\n  ')}`);
	const result = readManifest(dir);
	if (!result.ok) throw new Error(result.errors.join('\n'));

	console.log(`Bundling ${options.entry ?? 'main.ts'}…`);
	const bundle = await bundleApp(dir, { entry: options.entry, conditions: options.conditions });
	console.log(
		`Assembling on ${options.base ?? DEFAULT_BASE} for ${(options.platforms ?? []).map((p) => p.architecture).join(', ') || 'amd64, arm64'}…`
	);
	const image = await buildImage({
		bundle,
		manifestLabel: JSON.stringify(result.manifest),
		base: options.base,
		platforms: options.platforms,
		baseClient
	});
	return { image, id: result.manifest.id, version: result.manifest.version };
}

/** `pivi-app build`: the image as an OCI layout directory, without pushing it anywhere. */
export async function build(
	dir: string,
	options: ImageOptions & { out?: string }
): Promise<number> {
	const { image, id, version } = await assemble(dir, options);
	const out = resolve(options.out ?? join(dir, '.pivi-dev', 'image'));
	console.log('Writing the OCI layout (downloads the base layers once, then they are cached)…');
	await writeLayout(image, out, `pivi-${id}:${version}`);
	console.log(
		`\n✓ ${out}\n  index ${image.index.digest}\n  base  ${formatReference(image.base)}@${image.baseDigest}`
	);
	return 0;
}

/**
 * `pivi-app publish <ref>`: builds and pushes to any OCI registry. Without a tag in
 * the reference the image is tagged with the manifest's version and `latest`.
 */
export async function publish(
	dir: string,
	reference: string | undefined,
	options: ImageOptions & { tags?: string[] }
): Promise<number> {
	if (!reference) {
		console.error(
			'Usage: pivi-app publish [dir] <registry/repository[:tag]>, e.g. ghcr.io/me/my-app'
		);
		return 2;
	}
	const explicitTag = /:[^/]+$/.test(reference) || reference.includes('@');
	// A base image in the registry published to (a private one, say) is read with
	// the same credentials as the push.
	const registry = parseReference(reference).registry;
	const base = parseReference(options.base ?? DEFAULT_BASE);
	const baseClient =
		base.registry === registry
			? new RegistryClient(registry, findPublishCredentials(registry))
			: undefined;
	const { image, version } = await assemble(dir, options, baseClient);
	const target = parseReference(explicitTag ? reference : `${reference}:${version}`);
	const tags = [...(options.tags ?? []), ...(explicitTag ? [] : ['latest'])];
	console.log(`Pushing to ${target.registry}/${target.repository}…`);
	const { digest, references } = await pushImage(image, {
		target,
		baseClient,
		tags,
		onProgress: (message) => console.log(`  ${message}`)
	});
	console.log(`\n✓ published ${digest}`);
	for (const ref of references) console.log(`  ${ref}`);
	console.log(`\nInstall it in pivi with: ${references[0]}`);
	return 0;
}
