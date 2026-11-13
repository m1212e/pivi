// Scanning for and joining a wifi network from the TV's own /wifi screen
// (served over GraphQL by handlers/wifi.ts), so a network can be picked with
// the remote and the password typed through the phone's keyboard relay.
// Access control is left to the GraphQL side.
import type { WifiManagementState } from '#lib/wifi/management';
import { connectToNetwork, getNetworkState, isAvailable, scanNetworks, startHotspot } from './wifi';

// What's kept here rather than read fresh from NetworkManager each time: scan
// results (a scan takes seconds, and every screen that opens this page wants
// the same list), plus `connectingSsid`/`error` so a screen that reloads
// mid-join, or a second one, sees the same thing as the one that started it.
type Session = {
	networks: WifiManagementState['networks'];
	scanning: boolean;
	connectingSsid: string | null;
	error: string | null;
};

/** How the service tells the /wifi subscription to push fresh state, wired in wifiManagement.ts. */
export type ManagementEvents = {
	// The state shown to the user changed (scanning, connecting, an error, or
	// the networks/current-connection the device reports).
	stateChanged(): void;
};

// Reported when NetworkManager can't be reached at all, the most conservative
// reading instead of per field fallbacks at the point of use.
const UNKNOWN_NETWORK = {
	mode: 'disconnected',
	ssid: null,
	online: false,
	ethernet: false
} satisfies Pick<WifiManagementState, 'mode' | 'ssid' | 'online' | 'ethernet'>;

/**
 * Create one per process (wifiManagement.ts). Every screen shares its session,
 * so they all see the same scan results and join progress.
 */
export function createWifiManagement(events: ManagementEvents) {
	const session: Session = {
		networks: null,
		scanning: false,
		connectingSsid: null,
		error: null
	};

	async function currentNetwork() {
		return await getNetworkState().catch(() => UNKNOWN_NETWORK);
	}

	return {
		async state(): Promise<WifiManagementState> {
			// Asked regardless of `available`, since a wired only box still has a
			// real answer for ethernet and internet connectivity.
			const [available, network] = await Promise.all([isAvailable(), currentNetwork()]);
			return {
				available,
				mode: network.mode,
				ssid: network.ssid,
				online: network.online,
				ethernet: network.ethernet,
				...session
			};
		},

		async scan(): Promise<void> {
			// The screen hides the button without wifi hardware, so a request from
			// a stale screen is ignored instead of running a pointless nmcli call.
			if (!(await isAvailable())) return;

			session.scanning = true;
			session.error = null;
			events.stateChanged();

			try {
				session.networks = await scanNetworks();
			} catch (error) {
				session.error = error instanceof Error ? error.message : String(error);
			} finally {
				session.scanning = false;
				events.stateChanged();
			}
		},

		async connect(ssid: string, password: string, hidden: boolean): Promise<void> {
			// Same reasoning as scan() above.
			if (!(await isAvailable())) return;

			session.connectingSsid = ssid;
			session.error = null;
			// Pushed before the attempt, not just after it: joining takes several
			// seconds, and the screen should show that it started rather than
			// looking like the tap did nothing.
			events.stateChanged();

			const result = await connectToNetwork(ssid, password, hidden);

			session.connectingSsid = null;
			session.error = result.ok ? null : result.error;
			// A failed join left the radio disconnected with the hotspot already
			// torn down (it has to be, to attempt the join at all), which would
			// strand a phone that's still relying on it to stay paired. Put the AP
			// back up so the password can be corrected and tried again.
			if (!result.ok) await startHotspot().catch(() => {});

			events.stateChanged();
		}
	};
}
