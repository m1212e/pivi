// Where a phone lands after joining the setup AP: its OS probes for a captive
// portal, the AP's DNS and port-80 redirect send the probe to the device
// (nix/module.nix, deploy/pivi-server.mjs), and that redirects here. So the
// remote opens by itself instead of needing the second QR code scanned.
import { redirect } from '@sveltejs/kit';
import { REMOTE_PREFIX } from '#lib/routes';
import { createPairingToken } from '#api/pairing';
import { isOnSetupNetwork } from '#api/wifi';
import type { RequestHandler } from './$types';

// A token only for a phone on the setup network: on any other network this
// path is as reachable as the remote itself, and minting there would pair
// anyone on the LAN (see the note in pairingHook.ts).
export const GET: RequestHandler = async ({ getClientAddress }) => {
	const onSetupNetwork = await isOnSetupNetwork(getClientAddress()).catch(() => false);
	redirect(302, onSetupNetwork ? `${REMOTE_PREFIX}#${createPairingToken()}` : REMOTE_PREFIX);
};
