// The logic of scanning for and joining a wifi network, for the TV's own
// /wifi screen (over GraphQL, see handlers/wifi.ts, so a network can be
// picked with nothing but the remote's gestures and the phone's keyboard
// relay typing the password into whatever field has focus).
//
// The service only decides *what to do*; who is allowed to ask is the
// caller's business (the GraphQL side requires a paired phone to be
// connected, since that's the only way to drive this page at all).
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

export type ManagementEvents = {
	// The state shown to the user changed (scanning, connecting, an error, or
	// the networks/current-connection the device reports).
	stateChanged(): void;
};

// What to report when NetworkManager can't be reached at all (not merely
// "no wifi radio" -- see state() below, which asks regardless of that): the
// most conservative reading, rather than a field-by-field pile of fallbacks
// at the point of use.
const UNKNOWN_NETWORK = {
	mode: 'disconnected',
	ssid: null,
	online: false,
	ethernet: false
} satisfies Pick<WifiManagementState, 'mode' | 'ssid' | 'online' | 'ethernet'>;

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
			// Asked regardless of `available`: ethernet and internet connectivity
			// are independent of whether this device can also manage wifi, and a
			// wired-only box (or one mid-way through losing its wifi radio) still
			// has a real answer for both -- getNetworkState() itself handles there
			// being no wifi device at all, reporting a disconnected radio rather
			// than throwing.
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
			// The screen already hides the scan button once `available` is false
			// (see WifiManagerPanel.svelte), so a request reaching here anyway (a
			// stale screen, a second one) is simply ignored rather than attempting
			// an nmcli call a device without wifi hardware can't usefully answer.
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
