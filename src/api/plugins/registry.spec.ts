import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseImageRef } from '#lib/plugins/imageRef';
import type { PluginManifest } from '#lib/plugins/manifest';
import { FakeRegistry, publishPluginImage } from './fixtures';
import { pinnedReference, RegistryClient, RegistryError, resolveImage } from './registry';

const manifest: PluginManifest = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: ['network'],
	network: { domains: ['example.com'] },
	entryScreenId: 'main'
};

let registry: FakeRegistry;
beforeEach(async () => {
	registry = await new FakeRegistry().start();
});
afterEach(() => registry.stop());

const ref = (tag = '1.0') => parseImageRef(`${registry.registry}/acme/demo:${tag}`);

describe('resolveImage', () => {
	it('resolves a tag to a digest and reads the manifest label and entrypoint', async () => {
		const digest = publishPluginImage(registry, 'acme/demo', '1.0', manifest, {
			command: ['/bin/plugin', '--serve']
		});

		const image = await resolveImage(ref());
		expect(image.digest).toBe(digest);
		expect(image.manifest).toEqual(manifest);
		expect(image.command).toEqual(['/bin/plugin', '--serve']);
		expect(image.workingDir).toBe('/app');
	});

	it('picks the host platform out of a multi-arch index', async () => {
		const amd64 = publishPluginImage(registry, 'acme/demo', 'amd64', manifest, {
			command: ['/amd64']
		});
		const arm64 = publishPluginImage(
			registry,
			'acme/demo',
			'arm64',
			{ ...manifest, version: '1.0.0-arm' },
			{ command: ['/arm64'], architecture: 'arm64' }
		);
		registry.putManifest(
			'acme/demo',
			{
				schemaVersion: 2,
				mediaType: 'application/vnd.oci.image.index.v1+json',
				manifests: [
					{ digest: amd64, platform: { os: 'linux', architecture: 'amd64' } },
					{ digest: arm64, platform: { os: 'linux', architecture: 'arm64' } }
				]
			},
			'multi',
			'application/vnd.oci.image.index.v1+json'
		);

		const onPi = await resolveImage(ref('multi'), new RegistryClient(), {
			os: 'linux',
			architecture: 'arm64'
		});
		expect(onPi.command).toEqual(['/arm64']);
		expect(onPi.manifest.version).toBe('1.0.0-arm');

		await expect(
			resolveImage(ref('multi'), new RegistryClient(), { os: 'linux', architecture: 'amd64' })
		).resolves.toMatchObject({ command: ['/amd64'] });
	});

	it('says so when no build exists for the platform', async () => {
		publishPluginImage(registry, 'acme/demo', '1.0', manifest, { architecture: 'arm64' });
		const onlyArmIndex = {
			schemaVersion: 2,
			mediaType: 'application/vnd.oci.image.index.v1+json',
			manifests: [
				{
					digest: [...registry.entries.keys()]
						.find((k) => k.includes('manifests/sha256'))!
						.split('/')
						.pop(),
					platform: { os: 'linux', architecture: 'arm64' }
				}
			]
		};
		registry.putManifest(
			'acme/demo',
			onlyArmIndex,
			'idx',
			'application/vnd.oci.image.index.v1+json'
		);
		await expect(
			resolveImage(ref('idx'), new RegistryClient(), { os: 'linux', architecture: 'amd64' })
		).rejects.toThrow(/No linux\/amd64 build/);
	});

	it('follows a bearer-token challenge', async () => {
		publishPluginImage(registry, 'acme/demo', '1.0', manifest);
		registry.requireToken = true;
		await expect(resolveImage(ref())).resolves.toMatchObject({ manifest });
		expect(registry.requests).toContain('/token');
	});

	it('rejects an image that is not a pivi plugin', async () => {
		publishPluginImage(registry, 'acme/demo', '1.0', manifest, { label: null });
		await expect(resolveImage(ref())).rejects.toThrow(/Not a pivi plugin/);
	});

	it('rejects an invalid manifest, with the reason', async () => {
		publishPluginImage(registry, 'acme/demo', '1.0', manifest, {
			label: JSON.stringify({ ...manifest, permissions: ['filesystem'] })
		});
		await expect(resolveImage(ref())).rejects.toThrow(/Invalid plugin manifest/);
	});

	it('rejects a protocol version it cannot speak', async () => {
		publishPluginImage(registry, 'acme/demo', '1.0', { ...manifest, protocol: 99 });
		await expect(resolveImage(ref())).rejects.toThrow(/Unsupported plugin protocol/);
	});

	it('rejects an image with nothing to run', async () => {
		publishPluginImage(registry, 'acme/demo', '1.0', manifest, { command: [] });
		await expect(resolveImage(ref())).rejects.toThrow(/no ENTRYPOINT or CMD/);
	});

	it('names the registry when it cannot be reached', async () => {
		const unreachable = parseImageRef('localhost:1/acme/demo:1.0');
		await expect(resolveImage(unreachable)).rejects.toThrow(
			'Could not reach the registry localhost:1'
		);
	});

	it('reports a missing tag', async () => {
		await expect(resolveImage(ref('nope'))).rejects.toBeInstanceOf(RegistryError);
	});
});

describe('digest verification', () => {
	it('refuses a manifest whose body does not hash to the digest it was asked for', async () => {
		const digest = publishPluginImage(registry, 'acme/demo', '1.0', manifest);
		// The registry now serves something else under that digest.
		registry.put('acme/demo', `manifests/${digest}`, '{"tampered":true}');
		const client = new RegistryClient();
		await expect(client.getManifest(ref(), digest)).rejects.toThrow(/digest mismatch/);
	});

	it('refuses a blob that does not hash to its name', async () => {
		const digest = registry.putBlob('acme/demo', 'real content');
		registry.put('acme/demo', `blobs/${digest}`, 'swapped content');
		await expect(new RegistryClient().getBlob(ref(), digest)).rejects.toThrow(/digest mismatch/);
	});
});

describe('pinnedReference', () => {
	it('names the image by digest, not by the mutable tag', () => {
		const digest = `sha256:${'a'.repeat(64)}`;
		expect(pinnedReference(parseImageRef('ghcr.io/acme/demo:1.0'), digest)).toBe(
			`ghcr.io/acme/demo@${digest}`
		);
	});
});
