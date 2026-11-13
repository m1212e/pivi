// Brings up the provisioning access point at boot when the device has no other
// way onto a network. Without a known network or a paired phone nothing else
// could get it connected, so the TV shows how to join this AP
// (NetworkSetup.svelte) and the joined phone then drives the /wifi screen.
import { getNetworkState, isAvailable, startHotspot, type NetworkState } from './wifi';

// A wired device, a radio already on a network or one still serving the AP
// from a previous boot ('hotspot') needs no new AP.
function needsProvisioning(network: Pick<NetworkState, 'mode' | 'online' | 'ethernet'>): boolean {
	return !network.ethernet && !network.online && network.mode === 'disconnected';
}

/** Started once from handlers/register.ts so a fresh device can be set up from a phone. */
export async function startWifiProvisioning() {
	if (!(await isAvailable())) return;

	const network = await getNetworkState().catch(() => null);
	if (network && needsProvisioning(network)) await startHotspot().catch(() => {});
}
