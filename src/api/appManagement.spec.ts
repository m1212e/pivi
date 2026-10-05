import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppManifest } from '#lib/apps/manifest';
import { createAppManagement, type AppsState } from './appManagementService';
import type { AppDeps } from './apps/deps';
import {
	FakeRegistry,
	generateSigningKey,
	memoryStore,
	publishAppImage,
	signImage
} from './apps/fixtures';
import { RegistryClient } from './apps/registry';
import { verifyImageSignature } from './apps/signature';

const manifest: AppManifest = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: ['network', 'storage', 'cache'],
	network: { domains: ['api.example.com'] },
	entryScreenId: 'main'
};

let registry: FakeRegistry;
let key: ReturnType<typeof generateSigningKey>;
let userId: string | null;
let seen: { busy: AppsState['busy']; error: string | null }[];
let listChanges: number;
let service: ReturnType<typeof createAppManagement>;
let stateOf: () => Promise<AppsState>;

beforeEach(async () => {
	registry = await new FakeRegistry().start();
	key = generateSigningKey();
	userId = 'user-1';
	listChanges = 0;
	seen = [];

	const deps: AppDeps = {
		store: memoryStore(),
		registry: new RegistryClient(),
		backend: {
			prepare: () => Promise.resolve(),
			removeImage: () => Promise.resolve(),
			removeStale: () => Promise.resolve(),
			removeVolumes: () => Promise.resolve(),
			start: () => Promise.reject(new Error('not used'))
		},
		verify: verifyImageSignature,
		control: {
			isRunning: () => false,
			stop: () => Promise.resolve(),
			restart: () => Promise.resolve()
		}
	};
	service = createAppManagement(
		deps,
		{
			// Recorded as the state is read at the moment it is announced.
			stateChanged: () => void stateOf().then((s) => seen.push({ busy: s.busy, error: s.error })),
			listChanged: () => void listChanges++
		},
		() => Promise.resolve(userId)
	);
	stateOf = () => service.state();
});
afterEach(() => registry.stop());

const publish = () => {
	const digest = publishAppImage(registry, 'acme/demo', '1.0', manifest);
	signImage(registry, 'acme/demo', digest, key.privateKey);
};
const request = () => ({
	image: `${registry.registry}/acme/demo:1.0`,
	publicKey: key.publicKeyPem
});

describe('previewing', () => {
	it('holds the preview as shared state until it is installed or dismissed', async () => {
		publish();
		await service.preview(request());

		const state = await service.state();
		expect(state.preview).toMatchObject({
			name: 'Demo',
			version: '1.0.0',
			permissions: ['network', 'storage', 'cache'],
			domains: ['api.example.com'],
			conflict: false
		});
		expect(state.busy).toBeNull();
		expect(state.error).toBeNull();

		service.dismissPreview();
		expect((await service.state()).preview).toBeNull();
	});

	it('records a failure as state rather than throwing, and keeps no stale preview', async () => {
		publish();
		await service.preview(request());
		await service.preview({ ...request(), publicKey: 'not a key' });

		const state = await service.state();
		expect(state.error).toMatch(/not a public key/i);
		expect(state.preview).toBeNull();
	});

	it('announces being busy, then the result', async () => {
		publish();
		await service.preview(request());
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(seen.map((s) => s.busy)).toEqual(['previewing', null]);
		expect(listChanges).toBe(1);
	});
});

describe('installing and managing', () => {
	it('installs what was previewed, not whatever a screen sends along', async () => {
		publish();
		await service.preview(request());
		// A second screen asks to install with nothing but the permissions: the host
		// already knows which image and key were reviewed.
		await service.install(['storage']);
		expect((await service.state()).apps[0]).toMatchObject({
			id: 'demo',
			permissions: expect.arrayContaining([{ key: 'storage', granted: true }])
		});
	});

	it('refuses to install without a preview, and forgets the preview afterwards', async () => {
		await service.install(['network']);
		expect((await service.state()).error).toMatch(/Review the app/);

		publish();
		await service.preview(request());
		service.dismissPreview();
		await service.install(['network']);
		expect((await service.state()).error).toMatch(/Review the app/);
	});

	it('installs, clears the preview and lists the app', async () => {
		publish();
		await service.preview(request());
		await service.install(['network', 'storage']);

		const state = await service.state();
		expect(state.preview).toBeNull();
		expect(state.apps).toHaveLength(1);
		expect(state.apps[0]).toMatchObject({
			id: 'demo',
			enabled: true,
			permissions: [
				{ key: 'network', granted: true },
				{ key: 'storage', granted: true },
				{ key: 'cache', granted: false }
			]
		});
	});

	it('toggles settings and uninstalls', async () => {
		publish();
		await service.preview(request());
		await service.install(['network']);

		await service.setPermission('demo', 'cache', true);
		await service.setEnabled('demo', false);
		await service.setAutoUpdate('demo', false);
		const [app] = (await service.state()).apps;
		expect(app).toMatchObject({ enabled: false, autoUpdate: false });
		expect(app.permissions.find((p) => p.key === 'cache')?.granted).toBe(true);

		await service.uninstall('demo');
		expect((await service.state()).apps).toEqual([]);
	});

	it('reports a failed operation without throwing', async () => {
		await service.setEnabled('missing', true);
		expect((await service.state()).error).toMatch(/No app "missing"/);
	});

	it('clears an app cache only for an active profile', async () => {
		publish();
		await service.preview(request());
		await service.install(['cache']);

		await service.clearCache('demo');
		expect((await service.state()).error).toBeNull();

		userId = null;
		await service.clearCache('demo');
		expect((await service.state()).error).toMatch(/No profile is active/);
	});
});
