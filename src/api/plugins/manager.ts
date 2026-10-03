// Starts, caches and stops the running plugins. What's installed is the
// installed_plugin table (installer.ts); what's running is a sandbox started
// from the row's pinned image with only the permissions the user granted, bound
// to whichever profile is active — its storage and cache are that profile's.
//
// A plugin starts on first use rather than at boot: starting is a VM boot, and
// most of the time there's no profile active to start one for.
import { parseImageRef } from '#lib/plugins/imageRef';
import { getActiveProfileUser, onActiveProfileChanged } from '../activeProfile';
import { loadPlugin, type PluginInstance } from './runtime';
import { buildSandboxSpec } from './sandbox/spec';
import { microsandboxBackend } from './sandbox/microsandbox';
import { dbPluginStore, type InstalledPlugin } from './store';
import { dropStreamCache } from './streamCache';
import { ANY_DASHBOARD_EVENT } from './events';
import { pluginPubSub } from './pubsub';
import type { PluginProcessControl } from './deps';

const instances = new Map<string, Promise<PluginInstance>>();

async function spawnPlugin(row: InstalledPlugin): Promise<PluginInstance> {
	const user = await getActiveProfileUser();
	if (!user) throw new Error('No active profile to run a plugin for');

	const pluginId = row.pluginId;
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

	return loadPlugin({
		manifest: row.approvedManifest,
		granted: row.grantedPermissions,
		start: (handlers) => microsandboxBackend.start(spec, handlers),
		onUpdate: (kind, screenId) => {
			pluginPubSub.publish(
				kind === 'screen' ? `${pluginId}:screen:${screenId}` : `${pluginId}:${kind}`
			);
			if (kind === 'dashboard') pluginPubSub.publish(ANY_DASHBOARD_EVENT);
		},
		onCrash: (code) => {
			console.error(`[plugin:${pluginId}] exited unexpectedly (${code}); it restarts on next use`);
			instances.delete(pluginId);
		}
	});
}

export function getPlugin(pluginId: string): Promise<PluginInstance> {
	const existing = instances.get(pluginId);
	if (existing) return existing;

	const instance = (async () => {
		const row = await dbPluginStore.find(pluginId);
		if (!row || !row.enabled) throw new Error(`Unknown plugin: ${pluginId}`);
		return spawnPlugin(row);
	})();
	instances.set(pluginId, instance);
	// A plugin that failed to start shouldn't stay failed forever.
	instance.catch(() => {
		if (instances.get(pluginId) === instance) instances.delete(pluginId);
	});
	return instance;
}

// Every enabled plugin that started successfully. One that fails to start is
// logged and left out rather than taking every other plugin's listing down.
// With no profile active there's nothing to run them for.
export async function getAllPlugins(): Promise<PluginInstance[]> {
	if (!(await getActiveProfileUser())) return [];

	const rows = (await dbPluginStore.list()).filter((row) => row.enabled);
	const results = await Promise.allSettled(rows.map((row) => getPlugin(row.pluginId)));
	return results.flatMap((result, index) => {
		if (result.status === 'fulfilled') return [result.value];
		console.error(`[plugins] ${rows[index].pluginId} failed to start:`, result.reason);
		return [];
	});
}

async function stopPlugin(pluginId: string): Promise<void> {
	const instance = instances.get(pluginId);
	instances.delete(pluginId);
	dropStreamCache(pluginId);
	if (!instance) return;
	await instance.then((plugin) => plugin.dispose()).catch(() => {});
}

// Stops every running plugin, in parallel — used when the server shuts down, so
// no microVM outlives the process that owned it.
export async function stopAllPlugins(): Promise<void> {
	await Promise.all([...instances.keys()].map(stopPlugin));
}

export const processControl: PluginProcessControl = {
	isRunning: (pluginId) => instances.has(pluginId),
	stop: stopPlugin,
	async restart(pluginId) {
		await stopPlugin(pluginId);
		await getPlugin(pluginId);
	}
};

// Stopping every running plugin on every profile switch, rather than trusting
// each one to selectively reset whatever it holds in memory (a signed-in
// session, cached feeds, pending auth), is the only way to guarantee none of it
// survives into the next profile's session — and it's also what re-binds each
// plugin's storage and cache to the new profile. Persisted state lives in the
// profile's own volumes, which this leaves alone.
onActiveProfileChanged(() => {
	for (const pluginId of [...instances.keys()]) void stopPlugin(pluginId);
});
