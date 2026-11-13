import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardContribution } from '#sdk/dashboard';
import type { AppManifest } from '#sdk/manifest';
import type { AppInstance } from './runtime';
import { IDLE_STOP_MS } from './usage';

// Everything below the manager is faked: no database, profile or VM.
const profileListeners = vi.hoisted(() => [] as (() => void)[]);
vi.mock('../activeProfile', () => ({
	getActiveProfileUser: () => Promise.resolve({ id: 'user-1' }),
	onActiveProfileChanged: (listener: () => void) => profileListeners.push(listener)
}));

const manifest = {
	id: 'demo',
	name: 'Demo',
	protocol: 2,
	features: ['dashboard', 'screen'],
	permissions: [],
	entryScreenId: 'main'
} as unknown as AppManifest;

vi.mock('./store', () => {
	const row = {
		appId: 'demo',
		enabled: true,
		imageRef: 'registry.example.com/acme/demo:1',
		imageDigest: 'sha256:' + '0'.repeat(64),
		imageCommand: ['app'],
		imageWorkingDir: null,
		approvedManifest: manifest,
		grantedPermissions: []
	};
	return {
		dbAppStore: { list: () => Promise.resolve([row]), find: () => Promise.resolve(row) }
	};
});

const dashboard: DashboardContribution = { cards: [] };
type FakeInstance = {
	dispose: ReturnType<typeof vi.fn>;
	refreshDashboard: ReturnType<typeof vi.fn>;
	published?: DashboardContribution;
	crash: () => void;
};
const instances: FakeInstance[] = [];
vi.mock('./runtime', () => ({
	loadApp: vi.fn((options: { onCrash?: (code: number | null) => void }) => {
		const instance: FakeInstance = {
			published: dashboard,
			dispose: vi.fn(() => Promise.resolve()),
			refreshDashboard: vi.fn(),
			crash: () => options.onCrash?.(1)
		};
		instances.push(instance);
		return Promise.resolve({
			...instance,
			manifest,
			getDashboard: () => instance.published
		} as unknown as AppInstance);
	})
}));

vi.mock('./sandbox/microsandbox', () => ({ microsandboxBackend: {} }));

let manager: typeof import('./manager');

beforeAll(async () => {
	vi.useFakeTimers();
	manager = await import('./manager');
});
afterAll(() => vi.useRealTimers());

// Lets the manager's own promise chains settle under fake timers.
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('stopping idle apps', () => {
	beforeEach(async () => {
		await manager.stopAllApps();
		for (const listener of profileListeners) listener();
		instances.length = 0;
	});

	it('stops an app warmed up for the home screen once nobody used it', async () => {
		await manager.getStartedApps();
		await settle();
		expect(instances).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + 60_000);
		expect(instances[0].dispose).toHaveBeenCalled();
	});

	it('keeps showing an idle app’s dashboard without booting it again', async () => {
		await manager.getStartedApps();
		await settle();
		await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + 60_000);

		const apps = await manager.getStartedApps();
		await settle();
		expect(apps).toEqual([{ appId: 'demo', dashboard }]);
		expect(instances).toHaveLength(1);
	});

	it('boots a parked app again on real use', async () => {
		await manager.getStartedApps();
		await settle();
		await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + 60_000);

		await manager.getApp('demo');
		expect(instances).toHaveLength(2);
	});

	it('leaves an app alone while something holds it', async () => {
		await manager.getApp('demo');
		const release = manager.holdApp('demo');
		await vi.advanceTimersByTimeAsync(IDLE_STOP_MS * 3);
		expect(instances[0].dispose).not.toHaveBeenCalled();

		release();
		await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + 60_000);
		expect(instances[0].dispose).toHaveBeenCalled();
	});

	it('boots everything fresh for the next profile', async () => {
		await manager.getStartedApps();
		await settle();
		await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + 60_000);

		for (const listener of profileListeners) listener();
		await manager.getStartedApps();
		await settle();
		expect(instances).toHaveLength(2);
	});
});

describe('refreshing the home screen', () => {
	beforeEach(async () => {
		await manager.stopAllApps();
		for (const listener of profileListeners) listener();
		instances.length = 0;
	});

	it('asks a running app for fresh cards, at most twice a minute', async () => {
		await manager.getStartedApps();
		await settle();
		await vi.advanceTimersByTimeAsync(30_000);

		await manager.refreshDashboards();
		await manager.refreshDashboards();
		expect(instances[0].refreshDashboard).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(30_000);
		await manager.refreshDashboards();
		expect(instances[0].refreshDashboard).toHaveBeenCalledTimes(2);
	});

	it('boots an idle app again, showing its last cards until it publishes', async () => {
		await manager.getStartedApps();
		await settle();
		await vi.advanceTimersByTimeAsync(IDLE_STOP_MS + 60_000);

		await manager.refreshDashboards();
		await settle();
		expect(instances).toHaveLength(2);
		instances[1].published = undefined;
		expect(await manager.getStartedApps()).toEqual([{ appId: 'demo', dashboard }]);

		const fresh: DashboardContribution = { cards: [] };
		instances[1].published = fresh;
		expect((await manager.getStartedApps())[0].dashboard).toBe(fresh);
	});

	it('leaves a crashed app down until it is opened', async () => {
		await manager.getStartedApps();
		await settle();
		instances[0].crash();
		await vi.advanceTimersByTimeAsync(60_000);

		await manager.refreshDashboards();
		await settle();
		expect(instances).toHaveLength(1);

		await manager.getApp('demo');
		expect(instances).toHaveLength(2);
	});
});
