// Brings up the provisioning access point when the device has no other way
// onto a network. Without a known network or a paired phone nothing else
// could get it connected, so the TV shows how to join this AP
// (NetworkSetup.svelte) and the joined phone then drives the /wifi screen.
//
// Retried rather than tried once at boot: the radio may not be ready when the
// server starts, and a cable can be pulled later. Once the device is on a real
// network (a cable plugged in mid-setup, say), the AP comes down again: the
// pairing QR uses the first LAN address, which must not be the AP's, and the
// setup screen moves on by itself. The last failure is kept for the setup
// screen, since a device nobody can SSH into has no other way to say why its
// AP never appeared.
import { getNetworkState, isAvailable, startHotspot, stopHotspot, type NetworkState } from './wifi';
import { wifiManagement } from './wifiManagement';

const RETRY_MS = 15_000;

type Deps = {
	isAvailable: () => Promise<boolean>;
	getNetworkState: () => Promise<Pick<NetworkState, 'mode' | 'online' | 'ethernet'>>;
	startHotspot: () => Promise<void>;
	stopHotspot: () => Promise<void>;
	/** A join started on /wifi, which takes the AP down on purpose. */
	joining: () => boolean;
};

/** Exported for tests; the server runs the one started by startWifiProvisioning. */
export function createProvisioner(deps: Deps) {
	let lastError: string | null = null;
	let firstCheck = true;

	return {
		lastError: () => lastError,

		async check(): Promise<void> {
			if (deps.joining() || !(await deps.isAvailable())) return;
			const network = await deps.getNetworkState();
			const offline = !network.ethernet && !network.online;
			// A radio still serving the AP from a previous boot needs it brought
			// up again on the first check, since the passphrase is new each boot
			// and the old profile still holds the old one. After that, 'hotspot'
			// means it is up.
			const wanted =
				offline && (network.mode === 'disconnected' || (firstCheck && network.mode === 'hotspot'));
			firstCheck = false;
			if (!wanted) {
				if (offline) return;
				lastError = null;
				if (network.mode === 'hotspot') await deps.stopHotspot();
				return;
			}
			try {
				await deps.startHotspot();
				lastError = null;
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				console.error('wifi: could not start the setup access point:', lastError);
			}
		}
	};
}

const provisioner = createProvisioner({
	isAvailable,
	getNetworkState,
	startHotspot,
	stopHotspot,
	joining: () => wifiManagement.joining()
});

/** Why the setup access point failed to come up last time, for NetworkSetup.svelte. */
export const hotspotError = () => provisioner.lastError();

/** Started once from handlers/register.ts so a fresh device can be set up from a phone. */
export function startWifiProvisioning() {
	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			await provisioner.check();
		} catch (error) {
			console.error('wifi: provisioning check failed:', error);
		} finally {
			running = false;
		}
	};
	void tick();
	setInterval(tick, RETRY_MS).unref();
}
