// Bringing up the provisioning access point at boot, if the device has no
// other way to reach the network.
//
// This has to run before anything else needs wifi: with no known network and
// no phone paired yet, there is nothing else that could get one connected —
// the TV shows how to join this AP (NetworkSetup.svelte), and once a phone
// has joined and paired it drives the TV's own /wifi screen (see
// handlers/wifi.ts) like any other page, trackpad and keyboard relay
// included.
import { getNetworkState, isAvailable, startHotspot, type NetworkState } from './wifi';

// Ethernet counts: a wired device needs no provisioning, and raising an AP on
// it would be noise. So would raising one when the radio is already on a
// network, or when it is already serving the AP from a previous boot
// ('hotspot').
function needsProvisioning(network: Pick<NetworkState, 'mode' | 'online' | 'ethernet'>): boolean {
	return !network.ethernet && !network.online && network.mode === 'disconnected';
}

/** Called once at startup (src/api/handlers/register.ts). */
export async function startWifiProvisioning() {
	if (!(await isAvailable())) return;

	const network = await getNetworkState().catch(() => null);
	if (network && needsProvisioning(network)) await startHotspot().catch(() => {});
}
