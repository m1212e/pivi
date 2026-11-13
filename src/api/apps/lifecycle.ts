// Process-level app housekeeping, started once at server boot (see
// src/api/handlers/register.ts): clearing what a previous run left behind, and
// checking for app updates in the background.
import cron from 'node-cron';
import { defaultAppDeps } from './deps';
import { stopAllApps } from './manager';
import { announceAppListChanged } from './events';
import { SANDBOX_PREFIX } from './sandbox/spec';
import { checkAllForUpdates, type UpdateOutcome } from './updater';

// Survives dev server module reloads, which would otherwise start a second
// cron and shutdown hook.
declare global {
	var __piviAppHostStarted: boolean | undefined;
}

/**
 * A crashed server leaves its app VMs running, holding memory and the sandbox
 * names that new starts need.
 */
async function removeStaleSandboxes() {
	// With nothing installed there's nothing that could have been left running,
	// and no reason to load the sandbox runtime at all.
	if ((await defaultAppDeps.store.list()).length === 0) return;
	await defaultAppDeps.backend.removeStale(SANDBOX_PREFIX);
}

// Outcomes worth a line in the log, "nothing changed" isn't.
const NOTABLE = new Set<UpdateOutcome>(['applied', 'pending', 'failed']);

/**
 * Keeps apps current without the user opening the app manager. Announces the
 * list change since an applied update alters what's installed.
 */
async function runUpdateCheck() {
	const outcomes = await checkAllForUpdates(defaultAppDeps);
	announceAppListChanged();
	for (const [appId, outcome] of Object.entries(outcomes).filter(([, o]) => NOTABLE.has(o))) {
		console.log(`[apps] update check: ${appId} ${outcome}`);
	}
}

// Background jobs have no caller to throw to, so failures only get logged.
const logFailure = (what: string) => (error: unknown) =>
	console.error(`[apps] ${what}:`, error instanceof Error ? error.message : error);

/** Called once at boot by handlers/register.ts. Later calls (dev module reloads) are no-ops. */
export function startAppHost() {
	if (globalThis.__piviAppHostStarted) return;
	globalThis.__piviAppHostStarted = true;

	void removeStaleSandboxes().catch(logFailure('could not clean up stale sandboxes'));

	// Emitted by deploy/pivi-server.mjs on SIGTERM/SIGINT. A server that dies
	// without it (a crash) leaves its sandboxes behind, which the cleanup above
	// removes on the next start.
	process.once('sveltekit:shutdown', () => void stopAllApps());

	// Hourly, plus once shortly after boot, not at boot itself, when the
	// network (and the profile picker the user is looking at) is still settling.
	cron.schedule('17 * * * *', () => void runUpdateCheck().catch(logFailure('update check failed')));
	setTimeout(() => void runUpdateCheck().catch(logFailure('update check failed')), 2 * 60_000);
}
