// Process-level app housekeeping, started once at server boot (see
// src/api/handlers/register.ts): clearing what a previous run left behind, and
// checking for app updates in the background.
import cron from 'node-cron';
import { defaultAppDeps } from './deps';
import { stopAllApps } from './manager';
import { announceAppListChanged } from './events';
import { SANDBOX_PREFIX } from './sandbox/spec';
import { checkAllForUpdates, type UpdateOutcome } from './updater';

declare global {
	var __piviAppHostStarted: boolean | undefined;
}

async function removeStaleSandboxes() {
	// With nothing installed there's nothing that could have been left running,
	// and no reason to load the sandbox runtime at all.
	if ((await defaultAppDeps.store.list()).length === 0) return;
	await defaultAppDeps.backend.removeStale(SANDBOX_PREFIX);
}

// Outcomes worth a line in the log; "nothing changed" isn't.
const NOTABLE = new Set<UpdateOutcome>(['applied', 'pending', 'failed']);

async function runUpdateCheck() {
	const outcomes = await checkAllForUpdates(defaultAppDeps);
	announceAppListChanged();
	for (const [appId, outcome] of Object.entries(outcomes).filter(([, o]) => NOTABLE.has(o))) {
		console.log(`[apps] update check: ${appId} ${outcome}`);
	}
}

const logFailure = (what: string) => (error: unknown) =>
	console.error(`[apps] ${what}:`, error instanceof Error ? error.message : error);

export function startAppHost() {
	if (globalThis.__piviAppHostStarted) return;
	globalThis.__piviAppHostStarted = true;

	void removeStaleSandboxes().catch(logFailure('could not clean up stale sandboxes'));

	// Emitted by deploy/pivi-server.mjs on SIGTERM/SIGINT. A server that dies
	// without it (a crash) leaves its sandboxes behind, which the cleanup above
	// removes on the next start.
	process.once('sveltekit:shutdown', () => void stopAllApps());

	// Every six hours, plus once shortly after boot — not at boot itself, when the
	// network (and the profile picker the user is looking at) is still settling.
	cron.schedule(
		'17 */6 * * *',
		() => void runUpdateCheck().catch(logFailure('update check failed'))
	);
	setTimeout(() => void runUpdateCheck().catch(logFailure('update check failed')), 2 * 60_000);
}
