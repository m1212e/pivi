// Process-level plugin housekeeping, started once at server boot (see
// src/api/handlers/register.ts): clearing what a previous run left behind, and
// checking for plugin updates in the background.
import cron from 'node-cron';
import { defaultPluginDeps } from './deps';
import { stopAllPlugins } from './manager';
import { PLUGIN_LIST_EVENT } from './events';
import { pluginPubSub } from './pubsub';
import { SANDBOX_PREFIX } from './sandbox/spec';
import { checkAllForUpdates, type UpdateOutcome } from './updater';

declare global {
	var __piviPluginHostStarted: boolean | undefined;
}

async function removeStaleSandboxes() {
	// With nothing installed there's nothing that could have been left running,
	// and no reason to load the sandbox runtime at all.
	if ((await defaultPluginDeps.store.list()).length === 0) return;
	await defaultPluginDeps.backend.removeStale(SANDBOX_PREFIX);
}

// Outcomes worth a line in the log; "nothing changed" isn't.
const NOTABLE = new Set<UpdateOutcome>(['applied', 'pending', 'failed']);

async function runUpdateCheck() {
	const outcomes = await checkAllForUpdates(defaultPluginDeps);
	pluginPubSub.publish(PLUGIN_LIST_EVENT);
	for (const [pluginId, outcome] of Object.entries(outcomes).filter(([, o]) => NOTABLE.has(o))) {
		console.log(`[plugins] update check: ${pluginId} ${outcome}`);
	}
}

const logFailure = (what: string) => (error: unknown) =>
	console.error(`[plugins] ${what}:`, error instanceof Error ? error.message : error);

export function startPluginHost() {
	if (globalThis.__piviPluginHostStarted) return;
	globalThis.__piviPluginHostStarted = true;

	void removeStaleSandboxes().catch(logFailure('could not clean up stale sandboxes'));

	// Emitted by deploy/pivi-server.mjs on SIGTERM/SIGINT. A server that dies
	// without it (a crash) leaves its sandboxes behind, which the cleanup above
	// removes on the next start.
	process.once('sveltekit:shutdown', () => void stopAllPlugins());

	// Every six hours, plus once shortly after boot — not at boot itself, when the
	// network (and the profile picker the user is looking at) is still settling.
	cron.schedule(
		'17 */6 * * *',
		() => void runUpdateCheck().catch(logFailure('update check failed'))
	);
	setTimeout(() => void runUpdateCheck().catch(logFailure('update check failed')), 2 * 60_000);
}
