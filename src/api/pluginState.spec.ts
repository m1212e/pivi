import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '#lib/plugins/manifest';
import { describePlugin } from './pluginState';
import type { InstalledPlugin } from './plugins/store';

const manifest: PluginManifest = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: ['network', 'storage'],
	network: { domains: ['api.example.com'] },
	entryScreenId: 'main'
};

const row = (overrides: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
	id: 'row-1',
	createdAt: new Date(),
	updatedAt: new Date(),
	pluginId: 'demo',
	name: 'Demo',
	version: '1.0.0',
	imageRef: 'ghcr.io/acme/demo:1.0',
	imageDigest: `sha256:${'a'.repeat(64)}`,
	imageCommand: ['/run'],
	imageWorkingDir: null,
	signer: { publicKeyPem: 'pem', fingerprint: 'f'.repeat(64) },
	enabled: true,
	autoUpdate: true,
	approvedManifest: manifest,
	grantedPermissions: ['storage'],
	pendingUpdate: null,
	ignoredDigest: null,
	lastCheckedAt: null,
	lastError: null,
	...overrides
});

describe('describePlugin', () => {
	it('shows each requested permission with whether it is switched on', () => {
		const entry = describePlugin(row());
		expect(entry.permissions).toEqual([
			{ key: 'network', granted: false },
			{ key: 'storage', granted: true }
		]);
		expect(entry).toMatchObject({
			id: 'demo',
			domains: ['api.example.com'],
			update: null,
			error: null
		});
	});

	it('has no domains for a plugin that never asked for the network', () => {
		const modest = { ...manifest, permissions: ['storage' as const], network: undefined };
		expect(describePlugin(row({ approvedManifest: modest })).domains).toEqual([]);
	});

	it('describes what a waiting update additionally asks for', () => {
		const next: PluginManifest = {
			...manifest,
			version: '2.0.0',
			permissions: ['network', 'storage', 'cache'],
			network: { domains: ['api.example.com', 'cdn.example.com'] }
		};
		const entry = describePlugin(
			row({ pendingUpdate: { manifest: next, image: { digest: 'sha256:x', command: ['/run'] } } })
		);
		expect(entry.update).toEqual({
			version: '2.0.0',
			addedPermissions: ['cache'],
			addedDomains: ['cdn.example.com']
		});
	});

	it('carries the last error through', () => {
		expect(describePlugin(row({ lastError: 'it broke' })).error).toBe('it broke');
	});
});
