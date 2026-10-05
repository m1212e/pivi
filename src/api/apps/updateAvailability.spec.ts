import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppManifest } from '#lib/apps/manifest';
import type { AppDeps } from './deps';
import { FakeRegistry, publishAppImage } from './fixtures';
import { RegistryClient } from './registry';
import type { InstalledApp } from './store';
import { hasAvailableUpdate } from './updateAvailability';

const manifest: AppManifest = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: [],
	entryScreenId: 'main'
};

let registry: FakeRegistry;
beforeEach(async () => {
	registry = await new FakeRegistry().start();
});
afterEach(() => registry.stop());

// The in-process cache (see updateAvailability.ts) is keyed by appId alone
// and outlives a single test, so each case below uses its own appId --
// otherwise an earlier test's cached result would leak into a later one that
// reuses the same registry state.
let nextAppId = 0;

function row(overrides: Partial<InstalledApp> = {}): InstalledApp {
	return {
		id: 'row-1',
		appId: `demo-${nextAppId++}`,
		name: 'Demo',
		version: '1.0.0',
		imageRef: `${registry.registry}/acme/demo:latest`,
		imageDigest: 'sha256:stale',
		imageCommand: ['/app'],
		imageWorkingDir: null,
		enabled: true,
		autoUpdate: true,
		approvedManifest: manifest,
		grantedPermissions: [],
		signer: null,
		ignoredDigest: null,
		pendingUpdate: null,
		lastCheckedAt: null,
		lastError: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	};
}

function deps(): AppDeps {
	return {
		store: undefined as never,
		registry: new RegistryClient(),
		backend: undefined as never,
		verify: undefined as never,
		control: undefined as never
	};
}

describe('hasAvailableUpdate', () => {
	it('is true without asking the registry when an update is already pending approval', async () => {
		const r = row({
			imageRef: 'localhost:0/nowhere:latest',
			pendingUpdate: { manifest, image: { digest: 'sha256:new', command: ['/app'] } }
		});
		expect(await hasAvailableUpdate(deps(), r)).toBe(true);
		expect(registry.requests).toEqual([]);
	});

	it('is false when the registry still has the installed digest', async () => {
		const digest = publishAppImage(registry, 'acme/demo', 'latest', manifest);
		expect(await hasAvailableUpdate(deps(), row({ imageDigest: digest }))).toBe(false);
	});

	it('is true when the registry has a newer digest', async () => {
		publishAppImage(registry, 'acme/demo', 'latest', { ...manifest, version: '1.1.0' });
		expect(await hasAvailableUpdate(deps(), row())).toBe(true);
	});

	it('is false for a digest that was explicitly ignored', async () => {
		const digest = publishAppImage(registry, 'acme/demo', 'latest', {
			...manifest,
			version: '1.1.0'
		});
		expect(await hasAvailableUpdate(deps(), row({ ignoredDigest: digest }))).toBe(false);
	});

	it('caches a successful check instead of re-hitting the registry on every call', async () => {
		publishAppImage(registry, 'acme/demo', 'latest', { ...manifest, version: '1.1.0' });
		const r = row();
		await hasAvailableUpdate(deps(), r);
		const requestsAfterFirst = registry.requests.length;
		await hasAvailableUpdate(deps(), r);
		expect(registry.requests.length).toBe(requestsAfterFirst);
	});
});
