// The install/update flow against a real Postgres, to cover what the in-memory
// store can't: the table definition and the JSON columns' round trips. Skipped
// unless a database with the schema pushed is provided:
//
//   docker run -d -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=pivi -p 127.0.0.1:55432:5432 postgres:17
//   DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/pivi bun x drizzle-kit push --force
//   PIVI_DB_TEST=1 DATABASE_URL=… ORIGIN=http://localhost npx vitest run --project server store.db
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppManifest } from '#lib/apps/manifest';
import type { AppDeps } from './deps';
import { FakeRegistry, generateSigningKey, publishAppImage, signImage } from './fixtures';
import { installApp, setAppPermission, uninstallApp } from './installer';
import { RegistryClient } from './registry';
import { verifyImageSignature } from './signature';
import type { AppStore } from './store';
import { checkForUpdate } from './updater';

// The relay (reached through the runtime) isn't part of this.
vi.mock('../ws/relay', () => ({ sendToPhones: vi.fn() }));

const manifest: AppManifest = {
	id: 'dbtest',
	name: 'DB test',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: ['network', 'storage'],
	network: { domains: ['api.example.com'] },
	entryScreenId: 'main'
};

describe.skipIf(!process.env.PIVI_DB_TEST)('apps against a real database', () => {
	let registry: FakeRegistry;
	const key = generateSigningKey();
	let deps: AppDeps;
	// Loaded only when the suite actually runs: importing the store connects to
	// the database, which a skipped suite must not need.
	let dbAppStore: AppStore;

	beforeAll(async () => {
		({ dbAppStore } = await import('./store'));
		registry = await new FakeRegistry().start();
		deps = {
			store: dbAppStore,
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
		await dbAppStore.remove(manifest.id);
	});
	afterAll(async () => {
		await dbAppStore.remove(manifest.id);
		await registry.stop();
	});

	const publish = (m: AppManifest) => {
		const digest = publishAppImage(registry, 'acme/dbtest', '1.0', m, {
			command: ['/run', '--serve']
		});
		signImage(registry, 'acme/dbtest', digest, key.privateKey);
		return digest;
	};
	const image = () => `${registry.registry}/acme/dbtest:1.0`;

	it('stores and returns every column faithfully', async () => {
		const digest = publish(manifest);
		await installApp(deps, {
			image: image(),
			publicKey: key.publicKeyPem,
			granted: ['network', 'storage']
		});

		const row = (await dbAppStore.find('dbtest'))!;
		expect(row).toMatchObject({
			appId: 'dbtest',
			imageDigest: digest,
			imageCommand: ['/run', '--serve'],
			imageWorkingDir: '/app',
			approvedManifest: manifest,
			grantedPermissions: ['network', 'storage'],
			pendingUpdate: null,
			enabled: true
		});
		expect(row.signer?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect((await dbAppStore.list()).map((r) => r.appId)).toContain('dbtest');
	});

	it('keeps a parked update, with its manifest, through the JSON column', async () => {
		const next = { ...manifest, version: '2.0.0', permissions: ['network', 'storage', 'cache'] };
		const digest = publish(next as AppManifest);

		expect(await checkForUpdate(deps, 'dbtest')).toBe('pending');
		const row = (await dbAppStore.find('dbtest'))!;
		expect(row.pendingUpdate).toEqual({
			manifest: next,
			image: { digest, command: ['/run', '--serve'], workingDir: '/app' }
		});
	});

	it('updates permissions and removes the row', async () => {
		await setAppPermission(deps, 'dbtest', 'network', false);
		expect((await dbAppStore.find('dbtest'))!.grantedPermissions).toEqual(['storage']);

		await uninstallApp(deps, 'dbtest');
		expect(await dbAppStore.find('dbtest')).toBeUndefined();
	});
});
