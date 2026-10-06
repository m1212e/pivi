// Starts, caches and stops the running apps. What's installed is the
// installed_app table (installer.ts); what's running is a sandbox started
// from the row's pinned image with only the permissions the user granted, bound
// to whichever profile is active — its storage and cache are that profile's.
//
// An app starts on first use rather than at boot: starting is a VM boot, and
// most of the time there's no profile active to start one for.
import { parseImageRef } from '#lib/apps/imageRef';
import { getActiveProfileUser, onActiveProfileChanged } from '../activeProfile';
import { loadApp, type AppInstance } from './runtime';
import { buildSandboxSpec } from './sandbox/spec';
import { microsandboxBackend } from './sandbox/microsandbox';
import { dbAppStore, type InstalledApp } from './store';
import { dropStreamCache } from './streamCache';
import { ANY_DASHBOARD_EVENT } from './events';
import { appPubSub } from './pubsub';
import { onHostLocaleChanged } from './hostLocale';
import type { AppProcessControl } from './deps';

const instances = new Map<string, Promise<AppInstance>>();
// A VM still shutting down. Its sandbox name is the app's, so booting the next
// one before this settles makes the two collide and the new one gets killed.
const stopping = new Map<string, Promise<void>>();
// Instances whose VM has finished booting, for callers that must not wait on it.
const started = new Map<string, AppInstance>();

onHostLocaleChanged((locale) => {
	for (const app of started.values()) app.setLocale(locale);
});

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
		onCrash: (code) => {
			console.error(`[app:${appId}] exited unexpectedly (${code}); it restarts on next use`);
			instances.delete(appId);
		}
	});
}

export function getApp(appId: string): Promise<AppInstance> {
	const existing = instances.get(appId);
	if (existing) return existing;

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

// Starts every enabled app in the background and returns whichever are already
// up, so a caller (the home screen) can render right away and pick the rest up
// from the dashboard push events once they've booted.
export async function getStartedApps(): Promise<{ appId: string; app?: AppInstance }[]> {
	if (!(await getActiveProfileUser())) return [];

	const rows = (await dbAppStore.list()).filter((row) => row.enabled);
	return rows.map((row) => {
		void getApp(row.appId).catch((error) =>
			console.error(`[apps] ${row.appId} failed to start:`, error)
		);
		return { appId: row.appId, app: started.get(row.appId) };
	});
}

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

// Stops every running app, in parallel — used when the server shuts down, so
// no microVM outlives the process that owned it.
export async function stopAllApps(): Promise<void> {
	await Promise.all([...instances.keys()].map(stopApp));
}

export const processControl: AppProcessControl = {
	isRunning: (appId) => instances.has(appId),
	stop: stopApp,
	async restart(appId) {
		await stopApp(appId);
		await getApp(appId);
	}
};

// Stopping every running app on every profile switch, rather than trusting
// each one to selectively reset whatever it holds in memory (a signed-in
// session, cached feeds, pending auth), is the only way to guarantee none of it
// survives into the next profile's session — and it's also what re-binds each
// app's storage and cache to the new profile. Persisted state lives in the
// profile's own volumes, which this leaves alone.
onActiveProfileChanged(() => {
	for (const appId of [...instances.keys()]) void stopApp(appId);
});
