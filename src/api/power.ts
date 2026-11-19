// Turning things off from the TV: the whole device (app settings) or just the
// television it's plugged into, over HDMI-CEC (home screen). Both tools are
// pinned by the NixOS module, which also lets polkit allow the power off.
// Outside the appliance image they are unset and both fail with a message.
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SYSTEMCTL = process.env.PIVI_SYSTEMCTL;
const CEC_CTL = process.env.PIVI_CEC_CTL;

/** Shuts the device down. A Pi without a power button only comes back by replugging it. */
export async function powerOffDevice(): Promise<void> {
	if (!SYSTEMCTL) throw new Error('Powering off is not available on this system');
	await run(SYSTEMCTL, ['poweroff']);
}

/** Puts the connected TV into standby. Every HDMI port gets the command, since only the TV knows which one it's on. */
export async function turnOffTv(): Promise<void> {
	if (!CEC_CTL) throw new Error('HDMI-CEC is not available on this system');
	const adapters = (await readdir('/dev').catch(() => [])).filter((name) => /^cec\d+$/.test(name));
	if (adapters.length === 0) throw new Error('No HDMI-CEC adapter found');

	const results = await Promise.allSettled(
		adapters.map(async (name) => {
			const device = `/dev/${name}`;
			// A CEC message needs a logical address of its own to come from.
			await run(CEC_CTL, ['-d', device, '--playback', '--osd-name', 'pivi']);
			await run(CEC_CTL, ['-d', device, '--to', '0', '--standby']);
		})
	);
	const failure = results.find((result) => result.status === 'rejected');
	if (results.every((result) => result.status === 'rejected') && failure) {
		throw failure.reason;
	}
}
