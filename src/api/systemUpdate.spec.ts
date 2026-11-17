import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { version } from '../../package.json';

// The module reads its paths at import, so they're set up first: a state file
// as nix/updates.nix writes it, and a systemctl that records its arguments.
const dir = await mkdtemp(join(tmpdir(), 'pivi-update-'));
const state = join(dir, 'available');
const calls = join(dir, 'calls');
const systemctl = join(dir, 'systemctl');
process.env.PIVI_UPDATE_STATE = state;
process.env.PIVI_SYSTEMCTL = systemctl;

const update = await import('./systemUpdate');

describe('pivi updates', () => {
	beforeAll(async () => {
		await writeFile(
			systemctl,
			`#!/bin/sh\necho "$@" >> ${calls}\n[ "$1" = is-active ] && { echo inactive; exit 3; }\nexit 0\n`
		);
		await chmod(systemctl, 0o755);
	});
	afterAll(() => rm(dir, { recursive: true, force: true }));

	it('offers nothing until a release was downloaded', async () => {
		expect(await update.systemUpdateStatus()).toMatchObject({
			supported: true,
			current: version,
			available: null,
			checking: false
		});
		await expect(update.installSystemUpdate()).rejects.toThrow();
	});

	it('offers a downloaded release and installs it through its unit', async () => {
		await writeFile(state, JSON.stringify({ target: '/nix/store/x', version: 'v9.9.9' }));
		expect((await update.systemUpdateStatus()).available).toBe('9.9.9');
		await update.installSystemUpdate();
		expect((await update.systemUpdateStatus()).installing).toBe(true);
		expect(await readFile(calls, 'utf8')).toContain('start --no-block pivi-update-apply.service');
	});

	it('starts a check through its own unit, and remembers "later"', async () => {
		await update.checkForSystemUpdate();
		expect(await readFile(calls, 'utf8')).toContain('start --no-block pivi-update-check.service');
		update.postponeSystemUpdate();
		expect((await update.systemUpdateStatus()).postponed).toBe(true);
	});
});
