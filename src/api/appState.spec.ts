import { describe, expect, it } from 'vitest';
import type { AppManifest } from '#lib/apps/manifest';
import { describeApp } from './appState';
import type { InstalledApp } from './apps/store';

const manifest: AppManifest = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: ['network', 'storage'],
	network: { domains: ['api.example.com'] },
	entryScreenId: 'main'
};

const row = (overrides: Partial<InstalledApp> = {}): InstalledApp => ({
	id: 'row-1',
	createdAt: new Date(),
	updatedAt: new Date(),
	appId: 'demo',
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

describe('describeApp', () => {
	it('shows each requested permission with whether it is switched on', () => {
		const entry = describeApp(row());
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

	it('has no domains for an app that never asked for the network', () => {
		const modest = { ...manifest, permissions: ['storage' as const], network: undefined };
		expect(describeApp(row({ approvedManifest: modest })).domains).toEqual([]);
	});

	it('describes what a waiting update additionally asks for', () => {
		const next: AppManifest = {
			...manifest,
			version: '2.0.0',
			permissions: ['network', 'storage', 'cache'],
			network: { domains: ['api.example.com', 'cdn.example.com'] }
		};
		const entry = describeApp(
			row({ pendingUpdate: { manifest: next, image: { digest: 'sha256:x', command: ['/run'] } } })
		);
		expect(entry.update).toEqual({
			version: '2.0.0',
			addedPermissions: ['cache'],
			addedDomains: ['cdn.example.com']
		});
	});

	it('carries the last error through', () => {
		expect(describeApp(row({ lastError: 'it broke' })).error).toBe('it broke');
	});
});
