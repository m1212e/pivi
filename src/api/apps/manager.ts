// Starts, caches and stops the running apps. What's installed is the
// installed_app table (installer.ts). What's running is a sandbox started
// from the row's pinned image with only the permissions the user granted, bound
// to whichever profile is active, its storage and cache are that profile's.
//
// An app starts on first use rather than at boot: starting is a VM boot, and
// most of the time there's no profile active to start one for. It stops again
// once nothing uses it (usage.ts), and its last dashboard stays on the home
// screen until it runs again.
import { parseImageRef } from '#lib/apps/imageRef';
import type { DashboardContribution } from '#sdk/dashboard';
import { getActiveProfileUser, onActiveProfileChanged } from '../activeProfile';
import { loadApp, type AppInstance } from './runtime';
import { buildSandboxSpec } from './sandbox/spec';
import { microsandboxBackend } from './sandbox/microsandbox';
import { dbAppStore, type InstalledApp } from './store';
import { dropStreamCache } from './streamCache';
import { ANY_DASHBOARD_EVENT, forcedStopPubSub } from './events';
import { appPubSub } from './pubsub';
import { onHostLocaleChanged } from './hostLocale';
import type { AppProcessControl } from './deps';
import { createUsageTracker } from './usage';

const instances = new Map<string, Promise<AppInstance>>();
// A VM still shutting down. Its sandbox name is the app's, so booting the next
// one before this settles makes the two collide and the new one gets killed.
const stopping = new Map<string, Promise<void>>();
// Instances whose VM has finished booting, for callers that must not wait on it.
const started = new Map<string, AppInstance>();
// Apps that stopped on their own (idle, crashed, killed by the watchdog) with
// the dashboard they last published. The home screen shows that instead of
// booting them again, which would undo the idle stop on its next refresh, or
// restart a crashing app in a loop.
const parked = new Map<string, DashboardContribution | undefined>();
const usage = createUsageTracker();

// How often idle apps are looked for. Coarse, the idle window is minutes long.
const IDLE_CHECK_MS = 60_000;

onHostLocaleChanged((locale) => {
	for (const app of started.values()) app.setLocale(locale);
});

/** Built from the stored row, so the sandbox only ever gets what the user approved. */
async function spawnApp(row: InstalledApp): Promise<AppInstance> {
	const user = await getActiveProfileUser();
	if (!user) throw new Error('No active profile to run an app for');

	const appId = row.appId;
	const spec = buildSandboxSpec({
		ref: parseImageRef(row.imageRef),
		image: {
			digest: row.imageDigest,
			command: row.imageCommand,
			workingDir: row.imageWorkingDir ?? undefined
		},
		manifest: row.approvedManifest,
		granted: row.grantedPermissions,
		userId: user.id
	});

	return loadApp({
		manifest: row.approvedManifest,
		granted: row.grantedPermissions,
		start: (handlers) => microsandboxBackend.start(spec, handlers),
		onUpdate: (kind, screenId) => {
			appPubSub.publish(kind === 'screen' ? `${appId}:screen:${screenId}` : `${appId}:${kind}`);
			if (kind === 'dashboard') appPubSub.publish(ANY_DASHBOARD_EVENT);
		},
		cpus: spec.cpus,
		onCrash: (code) => {
			console.error(`[app:${appId}] exited unexpectedly (${code}); it restarts on next use`);
			forgetApp(appId);
		},
		onForcedStop: (reason) => {
			forgetApp(appId);
			forcedStopPubSub.publish('apps:forcedStop', {
				appId,
				appName: row.approvedManifest.name,
				reason
			});
		}
	});
}

// Forgets the dead process and its resolved streams, keeping its last
// dashboard parked, and tells the home screen. It restarts on next real use.
function forgetApp(appId: string): void {
	parked.set(appId, started.get(appId)?.getDashboard());
	instances.delete(appId);
	started.delete(appId);
	dropStreamCache(appId);
	appPubSub.publish(ANY_DASHBOARD_EVENT);
}

/**
 * The one way the screen, playback and stream handlers reach an app. Starts it
 * on demand, and concurrent callers share one pending start so a VM never boots
 * twice. Counts as using the app, see usage.ts.
 */
export function getApp(appId: string): Promise<AppInstance> {
	usage.touch(appId);
	return ensureApp(appId);
}

/**
 * Keeps an app from being stopped as idle while something uses it without
 * calling getApp all the time, an open screen or a running stream. Call the
 * returned function when that ends.
 */
export function holdApp(appId: string): () => void {
	return usage.hold(appId);
}

// getApp without counting as use, for warming apps up.
function ensureApp(appId: string): Promise<AppInstance> {
	const existing = instances.get(appId);
	if (existing) return existing;

	parked.delete(appId);
	usage.touch(appId);
	const instance = (async () => {
		await stopping.get(appId);
		const row = await dbAppStore.find(appId);
		if (!row || !row.enabled) throw new Error(`Unknown app: ${appId}`);
		return spawnApp(row);
	})();
	instances.set(appId, instance);
	instance.then(
		(app) => {
			if (instances.get(appId) === instance) started.set(appId, app);
		},
		() => {}
	);
	// An app that failed to start shouldn't stay failed forever.
	instance.catch(() => {
		if (instances.get(appId) === instance) instances.delete(appId);
	});
	return instance;
}

/**
 * Lets the home screen render right away with whichever apps are up, while the
 * rest boot in the background and arrive via dashboard events. Also called at
 * login (auth.ts) to warm the apps up before /home asks. A parked app answers
 * with its last dashboard and stays stopped. `dashboard` is undefined while an
 * app is still booting.
 */
export async function getStartedApps(): Promise<
	{ appId: string; dashboard?: DashboardContribution }[]
> {
	if (!(await getActiveProfileUser())) return [];

	const rows = (await dbAppStore.list()).filter((row) => row.enabled);
	return rows.map((row) => {
		const appId = row.appId;
		if (parked.has(appId)) return { appId, dashboard: parked.get(appId) ?? { cards: [] } };
		void ensureApp(appId).catch((error) =>
			console.error(`[apps] ${appId} failed to start:`, error)
		);
		return { appId, dashboard: started.get(appId)?.getDashboard() };
	});
}

// Parks every running app nobody used for the idle window.
function stopIdleApps(): void {
	for (const appId of usage.idle(started.keys())) {
		console.log(`[app:${appId}] idle, stopping it until it is used again`);
		parked.set(appId, started.get(appId)?.getDashboard());
		void stopApp(appId);
	}
}
setInterval(stopIdleApps, IDLE_CHECK_MS).unref();

/**
 * Behind every stop path (profile switch, shutdown, processControl). Drops the
 * stream cache too, since its urls came from the app that's going away.
 */
async function stopApp(appId: string): Promise<void> {
	const instance = instances.get(appId);
	instances.delete(appId);
	started.delete(appId);
	dropStreamCache(appId);
	if (!instance) return;

	const done = instance.then((app) => app.dispose()).catch(() => {});
	// Chained on any earlier stop too, so overlapping stops settle in order.
	const settled = Promise.all([stopping.get(appId), done]).then(() => {
		if (stopping.get(appId) === settled) stopping.delete(appId);
	});
	stopping.set(appId, settled);
	await settled;
}

/** Called on server shutdown (lifecycle.ts) so no microVM outlives the process that owned it. */
export async function stopAllApps(): Promise<void> {
	await Promise.all([...instances.keys()].map(stopApp));
}

/**
 * The real AppProcessControl, handed to installer.ts and updater.ts through
 * defaultAppDeps so they can stop or restart apps without importing this module.
 */
export const processControl: AppProcessControl = {
	isRunning: (appId) => instances.has(appId),
	// A disabled, uninstalled or updated app's old dashboard must not linger.
	async stop(appId) {
		parked.delete(appId);
		await stopApp(appId);
	},
	async restart(appId) {
		await stopApp(appId);
		await ensureApp(appId);
	}
};

// Stopping every running app on every profile switch, rather than trusting
// each one to selectively reset whatever it holds in memory (a signed-in
// session, cached feeds, pending auth), is the only way to guarantee none of it
// survives into the next profile's session, and it's also what re-binds each
// app's storage and cache to the new profile. Persisted state lives in the
// profile's own volumes, which this leaves alone.
onActiveProfileChanged(() => {
	// Parked dashboards belong to the previous profile too.
	parked.clear();
	for (const appId of [...instances.keys()]) void stopApp(appId);
});
