// The install/update/permission logic, against a real (fake) registry and an
// in-memory store, with the sandbox backend and process control recorded.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PermissionKey, AppManifest } from '#lib/apps/manifest';
import type { AppDeps, AppProcessControl } from './deps';
import {
	FakeRegistry,
	generateSigningKey,
	memoryStore,
	publishAppImage,
	signImage
} from './fixtures';
import {
	clearAppCache,
	installApp,
	AppError,
	previewInstall,
	setAppAutoUpdate,
	setAppEnabled,
	setAppPermission,
	uninstallApp
} from './installer';
import { RegistryClient } from './registry';
import { volumeName } from './sandbox/spec';
import type { SandboxBackend } from './sandbox/types';
import { verifyImageSignature } from './signature';
import { approvePendingUpdate, checkForUpdate, rejectPendingUpdate } from './updater';

const base: AppManifest = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: ['network', 'storage'],
	network: { domains: ['api.example.com'] },
	entryScreenId: 'main'
};

type Calls = { prepared: string[]; removedImages: string[]; removedVolumes: string[] };

let registry: FakeRegistry;
let key: ReturnType<typeof generateSigningKey>;
let calls: Calls;
let running: Set<string>;
let stops: string[];
let failRestart: boolean;
let deps: AppDeps;

beforeEach(async () => {
	registry = await new FakeRegistry().start();
	key = generateSigningKey();
	calls = { prepared: [], removedImages: [], removedVolumes: [] };
	running = new Set();
	stops = [];
	failRestart = false;

	const backend: SandboxBackend = {
		prepare: (image) => {
			calls.prepared.push(image);
			return Promise.resolve();
		},
		removeImage: (image) => {
			calls.removedImages.push(image);
			return Promise.resolve();
		},
		removeStale: () => Promise.resolve(),
		start: () => Promise.reject(new Error('not used')),
		removeVolumes: (predicate) => {
			for (const name of [
				volumeName('demo', 'user-1', 'storage'),
				volumeName('demo', 'user-1', 'cache'),
				volumeName('other', 'user-1', 'storage')
			]) {
				if (predicate(name)) calls.removedVolumes.push(name);
			}
			return Promise.resolve();
		}
	};
	const control: AppProcessControl = {
		isRunning: (id) => running.has(id),
		stop: (id) => {
			stops.push(id);
			return Promise.resolve();
		},
		restart: () => (failRestart ? Promise.reject(new Error('boom')) : Promise.resolve())
	};
	deps = {
		store: memoryStore(),
		registry: new RegistryClient(),
		backend,
		verify: verifyImageSignature,
		control
	};
});
afterEach(() => registry.stop());

const image = () => `${registry.registry}/acme/demo:1.0`;
const publish = (manifest: AppManifest, sign = true, tag = '1.0') => {
	const digest = publishAppImage(registry, 'acme/demo', tag, manifest);
	if (sign) signImage(registry, 'acme/demo', digest, key.privateKey);
	return digest;
};
const install = (granted: PermissionKey[] = ['network', 'storage']) =>
	installApp(deps, { image: image(), publicKey: key.publicKeyPem, granted });

describe('installing', () => {
	it('previews without storing anything', async () => {
		publish(base);
		const preview = await previewInstall(deps, { image: image(), publicKey: key.publicKeyPem });
		expect(preview).toMatchObject({ manifest: base, conflict: false });
		expect(await deps.store.list()).toEqual([]);
		expect(calls.prepared).toEqual([]);
	});

	it('records the pinned image and only the permissions that were both asked for and chosen', async () => {
		const digest = publish(base);
		const row = await install(['network', 'cache' as PermissionKey]);

		expect(row).toMatchObject({
			appId: 'demo',
			imageDigest: digest,
			imageRef: image(),
			enabled: true,
			autoUpdate: true,
			grantedPermissions: ['network'] // 'cache' was never asked for
		});
		expect(row.signer?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		// Pulled up front, by digest.
		expect(calls.prepared).toEqual([`${registry.registry}/acme/demo@${digest}`]);
	});

	it('refuses an unsigned image, and stores nothing', async () => {
		publish(base, false);
		await expect(install()).rejects.toThrow(/no signature/);
		expect(await deps.store.list()).toEqual([]);
	});

	it('installs an unsigned image when no public key is given, with a null signer', async () => {
		publish(base, false);
		const row = await installApp(deps, { image: image(), granted: ['network', 'storage'] });
		expect(row.signer).toBeNull();
	});

	it('refuses an image signed by a different key', async () => {
		publish(base);
		await expect(
			installApp(deps, {
				image: image(),
				publicKey: generateSigningKey().publicKeyPem,
				granted: []
			})
		).rejects.toThrow(/not signed by key/);
	});

	it('refuses a second app with the same id', async () => {
		publish(base);
		await install();
		await expect(install()).rejects.toThrow(/already installed/);
		const preview = await previewInstall(deps, { image: image(), publicKey: key.publicKeyPem });
		expect(preview.conflict).toBe(true);
	});

	it('requires a tag, so the app can be updated', async () => {
		const digest = publish(base);
		await expect(
			installApp(deps, {
				image: `${registry.registry}/acme/demo@${digest}`,
				publicKey: key.publicKeyPem,
				granted: []
			})
		).rejects.toThrow(/with a tag/);
	});
});

describe('configuring', () => {
	it('toggles a permission, restarting the app so it takes effect', async () => {
		publish(base);
		await install();
		await setAppPermission(deps, 'demo', 'network', false);
		expect((await deps.store.find('demo'))!.grantedPermissions).toEqual(['storage']);
		expect(stops).toEqual(['demo']);

		await setAppPermission(deps, 'demo', 'network', true);
		expect((await deps.store.find('demo'))!.grantedPermissions.sort()).toEqual([
			'network',
			'storage'
		]);
	});

	it('refuses a permission the app never asked for', async () => {
		publish(base);
		await install();
		await expect(setAppPermission(deps, 'demo', 'cache', true)).rejects.toThrow(/does not ask/);
	});

	it('disabling stops the app; auto-update is just a flag', async () => {
		publish(base);
		await install();
		await setAppEnabled(deps, 'demo', false);
		expect((await deps.store.find('demo'))!.enabled).toBe(false);
		expect(stops).toEqual(['demo']);

		await setAppAutoUpdate(deps, 'demo', false);
		expect((await deps.store.find('demo'))!.autoUpdate).toBe(false);
	});

	it('clears only the cache volume of the given profile', async () => {
		publish(base);
		await install();
		await clearAppCache(deps, 'demo', 'user-1');
		expect(calls.removedVolumes).toEqual([volumeName('demo', 'user-1', 'cache')]);
	});

	it('uninstalling removes the row, the app volumes and the image', async () => {
		const digest = publish(base);
		await install();
		await uninstallApp(deps, 'demo');
		expect(await deps.store.find('demo')).toBeUndefined();
		expect(calls.removedVolumes.sort()).toEqual(
			[volumeName('demo', 'user-1', 'storage'), volumeName('demo', 'user-1', 'cache')].sort()
		);
		expect(calls.removedImages).toEqual([`${registry.registry}/acme/demo@${digest}`]);
		await expect(setAppEnabled(deps, 'demo', true)).rejects.toBeInstanceOf(AppError);
	});
});

describe('updating', () => {
	const next = (overrides: Partial<AppManifest> = {}) => ({
		...base,
		version: '1.1.0',
		...overrides
	});

	it('does nothing when the tag still points at the pinned digest', async () => {
		publish(base);
		await install();
		expect(await checkForUpdate(deps, 'demo')).toBe('unchanged');
	});

	it('applies a signed update that asks for nothing more, restarting a running app', async () => {
		const first = publish(base);
		await install();
		running.add('demo');
		const second = publish(next());

		expect(await checkForUpdate(deps, 'demo')).toBe('applied');
		const row = (await deps.store.find('demo'))!;
		expect(row).toMatchObject({ imageDigest: second, version: '1.1.0', pendingUpdate: null });
		// The old image is cleaned up once the new one is running.
		expect(calls.removedImages).toEqual([`${registry.registry}/acme/demo@${first}`]);
	});

	it('rolls back to the previous version when the new one will not start', async () => {
		const first = publish(base);
		await install();
		running.add('demo');
		publish(next());
		failRestart = true;

		expect(await checkForUpdate(deps, 'demo')).toBe('failed');
		const row = (await deps.store.find('demo'))!;
		expect(row.imageDigest).toBe(first);
		expect(row.version).toBe('1.0.0');
		expect(row.lastError).toMatch(/rolled back/);

		// ...and the same broken build isn't retried on every check.
		expect(await checkForUpdate(deps, 'demo')).toBe('ignored');
	});

	it('applies an unsigned update for an app installed without a signer', async () => {
		publish(base, false);
		await installApp(deps, { image: image(), granted: ['network', 'storage'] });
		const second = publish(next(), false);

		expect(await checkForUpdate(deps, 'demo')).toBe('applied');
		expect((await deps.store.find('demo'))!.imageDigest).toBe(second);
	});

	it('refuses an update that is not signed by the pinned key', async () => {
		const first = publish(base);
		await install();
		publish(next(), false); // new build, no signature
		expect(await checkForUpdate(deps, 'demo')).toBe('failed');
		const row = (await deps.store.find('demo'))!;
		expect(row.imageDigest).toBe(first);
		expect(row.lastError).toMatch(/no signature/);
	});

	it('refuses an update signed by someone else, even if well-formed', async () => {
		const first = publish(base);
		await install();
		const digest = publishAppImage(registry, 'acme/demo', '1.0', next());
		signImage(registry, 'acme/demo', digest, generateSigningKey().privateKey);
		expect(await checkForUpdate(deps, 'demo')).toBe('failed');
		expect((await deps.store.find('demo'))!.imageDigest).toBe(first);
	});

	it('refuses an update that turns out to be a different app', async () => {
		const first = publish(base);
		await install();
		publish(next({ id: 'something-else' }));
		expect(await checkForUpdate(deps, 'demo')).toBe('failed');
		expect((await deps.store.find('demo'))!.imageDigest).toBe(first);
	});

	it('parks an update that asks for more, leaving the running version alone', async () => {
		const first = publish(base);
		await install();
		running.add('demo');
		publish(next({ permissions: ['network', 'storage', 'cache'] }));

		expect(await checkForUpdate(deps, 'demo')).toBe('pending');
		const row = (await deps.store.find('demo'))!;
		expect(row.imageDigest).toBe(first);
		expect(row.pendingUpdate?.manifest.permissions).toContain('cache');
		expect(await checkForUpdate(deps, 'demo')).toBe('pending'); // not re-staged

		await approvePendingUpdate(deps, 'demo');
		const approved = (await deps.store.find('demo'))!;
		expect(approved.version).toBe('1.1.0');
		expect(approved.pendingUpdate).toBeNull();
		// What the user had on stays on, and what's newly asked for is granted by approving.
		expect(approved.grantedPermissions.sort()).toEqual(['cache', 'network', 'storage']);
	});

	it('parks a widened domain list too', async () => {
		publish(base);
		await install();
		publish(next({ network: { domains: ['api.example.com', 'tracker.example.net'] } }));
		expect(await checkForUpdate(deps, 'demo')).toBe('pending');
	});

	it('only parks (never applies) when auto-update is off', async () => {
		const first = publish(base);
		await install();
		await setAppAutoUpdate(deps, 'demo', false);
		publish(next());
		expect(await checkForUpdate(deps, 'demo')).toBe('pending');
		expect((await deps.store.find('demo'))!.imageDigest).toBe(first);
	});

	it('remembers a rejected update instead of asking again', async () => {
		publish(base);
		await install();
		publish(next({ permissions: ['network', 'storage', 'cache'] }));
		await checkForUpdate(deps, 'demo');
		await rejectPendingUpdate(deps, 'demo');

		expect((await deps.store.find('demo'))!.pendingUpdate).toBeNull();
		expect(await checkForUpdate(deps, 'demo')).toBe('ignored');
	});
});
