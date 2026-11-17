// pivi's own updates, as opposed to the apps' (src/api/apps/updater.ts).
// nix/updates.nix downloads a new release shortly after boot and leaves it
// for the TV to offer: after a login (SystemUpdatePrompt.svelte) and in the
// app settings. Installing it, or looking for a newer one, means starting that
// module's systemd units, which polkit lets this service do and nothing else.
//
// Outside the appliance image (development, a plain NixOS host) the variables
// below are unset and the TV simply never offers anything.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import { version as currentVersion } from '../../package.json';

const run = promisify(execFile);

const STATE_FILE = process.env.PIVI_UPDATE_STATE;
const SYSTEMCTL = process.env.PIVI_SYSTEMCTL;

const CHECK_UNIT = 'pivi-update-check.service';
const APPLY_UNIT = 'pivi-update-apply.service';

const availableSchema = z.object({ target: z.string(), version: z.string() });

export type SystemUpdateStatus = {
	/** Whether this device updates itself at all. */
	supported: boolean;
	current: string;
	/** A downloaded release waiting to be installed. */
	available: string | null;
	checking: boolean;
	installing: boolean;
	/** "Later" was picked on the prompt; it stays quiet until the next boot. */
	postponed: boolean;
};

let postponed = false;
let installing = false;

// Release tags carry a leading `v`, package.json doesn't.
const bare = (version: string) => version.replace(/^v/, '');

async function readAvailable(): Promise<string | null> {
	if (!STATE_FILE) return null;
	try {
		const parsed = availableSchema.safeParse(JSON.parse(await readFile(STATE_FILE, 'utf8')));
		return parsed.success ? bare(parsed.data.version) : null;
	} catch {
		// No file is the normal case: nothing downloaded, or already installed.
		return null;
	}
}

// `is-active` exits non-zero for anything but active, with the state on stdout
// either way. A oneshot reads `activating` while it runs.
async function unitRunning(unit: string): Promise<boolean> {
	if (!SYSTEMCTL) return false;
	let state: string;
	try {
		state = (await run(SYSTEMCTL, ['is-active', unit])).stdout;
	} catch (error) {
		state = String((error as { stdout?: unknown }).stdout ?? '');
	}
	return ['active', 'activating'].includes(state.trim());
}

function startUnit(unit: string): Promise<unknown> {
	if (!SYSTEMCTL) return Promise.reject(new Error('This device does not update itself'));
	// --no-block: the check downloads a whole system, and the install reboots.
	return run(SYSTEMCTL, ['start', '--no-block', unit]);
}

export async function systemUpdateStatus(): Promise<SystemUpdateStatus> {
	const [available, checking] = await Promise.all([readAvailable(), unitRunning(CHECK_UNIT)]);
	return {
		supported: Boolean(STATE_FILE && SYSTEMCTL),
		current: currentVersion,
		available,
		checking,
		installing,
		postponed
	};
}

export function checkForSystemUpdate(): Promise<unknown> {
	return startUnit(CHECK_UNIT);
}

export async function installSystemUpdate(): Promise<void> {
	if (!(await readAvailable())) throw new Error('No update has been downloaded yet');
	await startUnit(APPLY_UNIT);
	installing = true;
}

export function postponeSystemUpdate(): void {
	postponed = true;
}
