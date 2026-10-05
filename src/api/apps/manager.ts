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
import type { AppProcessControl } from './deps';

const instances = new Map<string, Promise<AppInstance>>();

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
		const row = await dbAppStore.find(appId);
		if (!row || !row.enabled) throw new Error(`Unknown app: ${appId}`);
		return spawnApp(row);
	})();
	instances.set(appId, instance);
	// An app that failed to start shouldn't stay failed forever.
	instance.catch(() => {
		if (instances.get(appId) === instance) instances.delete(appId);
	});
	return instance;
}

// Every enabled app that started successfully. One that fails to start is
// logged and left out rather than taking every other app's listing down.
// With no profile active there's nothing to run them for.
export async function getAllApps(): Promise<AppInstance[]> {
	if (!(await getActiveProfileUser())) return [];

	const rows = (await dbAppStore.list()).filter((row) => row.enabled);
	const results = await Promise.allSettled(rows.map((row) => getApp(row.appId)));
	return results.flatMap((result, index) => {
		if (result.status === 'fulfilled') return [result.value];
		console.error(`[apps] ${rows[index].appId} failed to start:`, result.reason);
		return [];
	});
}

async function stopApp(appId: string): Promise<void> {
	const instance = instances.get(appId);
	instances.delete(appId);
	dropStreamCache(appId);
	if (!instance) return;
	await instance.then((app) => app.dispose()).catch(() => {});
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
