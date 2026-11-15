import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MANIFEST_LABEL } from '@pivi/sdk/manifest';
import { bundleTo } from '../bundle';
import {
	buildImage,
	DEFAULT_PLATFORMS,
	exportLayout,
	findTool,
	pushImage,
	type Credentials,
	type Platform,
	type Tool
} from '../image/builder';
import { containerfile, containerignore } from '../image/containerfile';
import { formatImageRef, parseImageRef } from '@pivi/sdk/image';
import { generateKeyPair, signImage, signingKeyFromEnv } from '../image/sign';
import { BUNDLE_DIR, DEV_DIR } from '../paths';
import { readManifest } from '../project';
import { checkProject } from '../staticChecks';

export type ImageOptions = {
	entry?: string;
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

/** The project's own Containerfile (or Dockerfile), or the default one. */
function chooseContainerfile(dir: string) {
	for (const name of ['Containerfile', 'Dockerfile']) {
		if (existsSync(join(dir, name))) return { file: join(dir, name), ignorefile: undefined };
	}
	const generated = join(dir, DEV_DIR);
	mkdirSync(generated, { recursive: true });
	writeFileSync(join(generated, 'Containerfile'), containerfile());
	writeFileSync(join(generated, 'containerignore'), containerignore);
	return { file: join(generated, 'Containerfile'), ignorefile: join(generated, 'containerignore') };
}

/**
 * Validates the app (an image the host would refuse is not worth building), bundles it
 * and builds the image for every platform into a local manifest list.
 */
async function buildLocal(
	dir: string,
	options: ImageOptions
): Promise<{ tool: Tool; name: string; version: string }> {
	const root = resolve(dir);
	const errors = checkProject(root, options.entry).filter((f) => f.level === 'error');
	if (errors.length)
		throw new Error(`The app is not valid:\n  ${errors.map((e) => e.message).join('\n  ')}`);
	const result = readManifest(root);
	if (!result.ok) throw new Error(result.errors.join('\n'));
	const tool = findTool();

	console.log(`Bundling ${options.entry ?? 'main.ts'} with tsdown…`);
	await bundleTo(root, join(root, BUNDLE_DIR), {
		entry: options.entry,
		conditions: options.conditions
	});

	const { id, version } = result.manifest;
	const name = `pivi-${id}:${version}`;
	const { file, ignorefile } = chooseContainerfile(root);
	const platforms = options.platforms ?? DEFAULT_PLATFORMS;
	console.log(
		`Building ${name} with ${tool} for ${platforms.map((p) => p.architecture).join(', ')}…`
	);
	buildImage(tool, {
		name,
		context: root,
		containerfile: file,
		ignorefile,
		platforms,
		labels: { [MANIFEST_LABEL]: JSON.stringify(result.manifest) }
	});
	return { tool, name, version };
}

/** `pivi-app build`: the image as a local manifest list, and optionally an OCI layout. */
export async function build(
	dir: string,
	options: ImageOptions & { out?: string }
): Promise<number> {
	const { tool, name } = await buildLocal(dir, options);
	if (options.out) {
		exportLayout(tool, name, resolve(options.out));
		console.log(`\n✓ ${name}, written as an OCI layout to ${resolve(options.out)}`);
	} else {
		console.log(`\n✓ ${name} (a local manifest list: \`${tool} manifest inspect ${name}\`)`);
	}
	return 0;
}

/** Credentials for the registry published to, from the environment. Otherwise buildah's own login. */
function publishCredentials(): Credentials | undefined {
	const username = process.env.PIVI_REGISTRY_USERNAME;
	const password = process.env.PIVI_REGISTRY_PASSWORD;
	return username && password ? { username, password } : undefined;
}

/**
 * `pivi-app publish <ref>`: builds and pushes to any OCI registry. Without a tag in
 * the reference the image is tagged with the manifest's version and `latest`.
 */
export async function publish(
	dir: string,
	reference: string | undefined,
	options: ImageOptions & { tags?: string[]; sign?: string }
): Promise<number> {
	if (!reference) {
		console.error(
			'Usage: pivi-app publish [dir] <registry/repository[:tag]>, e.g. ghcr.io/me/my-app'
		);
		return 2;
	}
	const explicitTag = /:[^/]+$/.test(reference);
	const { tool, name, version } = await buildLocal(dir, options);
	const target = parseImageRef(explicitTag ? reference : `${reference}:${version}`);
	const tags = [
		...new Set([target.tag!, ...(options.tags ?? []), ...(explicitTag ? [] : ['latest'])])
	];
	const credentials = publishCredentials();
	let digest = '';
	for (const tag of tags) {
		console.log(`Pushing ${formatImageRef({ ...target, tag })}…`);
		digest = pushImage(tool, name, { ...target, tag }, credentials);
	}
	const signing = signingKeyFromEnv(options.sign);
	if (signing) {
		console.log('Signing…');
		signImage({ ...target, tag: tags[0] }, signing, credentials);
	}
	console.log(`\n✓ published ${digest}${signing ? ', signed' : ''}`);
	for (const tag of tags) console.log(`  ${formatImageRef({ ...target, tag })}`);
	console.log(`\nInstall it in pivi with: ${formatImageRef({ ...target, tag: tags[0] })}`);
	return 0;
}

/** `pivi-app keygen [prefix]`: a key pair for signing, `<prefix>.private` and `<prefix>.pub`. */
export function keygen(prefix = 'pivi-signing'): number {
	generateKeyPair(prefix, process.env.PIVI_SIGNING_PASSPHRASE);
	console.log(`\nKeep ${prefix}.private secret (and its passphrase). Publish with:`);
	console.log(`  pivi-app publish <ref> --sign ${prefix}.private`);
	console.log(
		`Give users ${prefix}.pub: pivi asks for it at install and accepts updates only signed by it.`
	);
	return 0;
}
