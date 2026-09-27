// Wifi provisioning, the protocol half: answers the phone's `wifi/*`
// notifications server-side and pushes state back to it.
//
// Why the phone and not the TV: at first boot the device has no network, so
// there is nothing to type a password *into* — the TV has no keyboard, and the
// existing phone remote already is one. The bootstrap that makes this possible
// is the provisioning access point: with no known network, the device serves
// its own AP, the TV shows how to join it, and the phone pairs over that AP
// exactly as it would over the house wifi. No cloud, no second app, no
// captive-portal web server of its own.
//
// Why it is not a route: these arrive over the paired, encrypted relay
// connection (src/api/ws/relay.ts), which is already the trust boundary for
// "this phone is allowed to drive this device". An HTTP endpoint would need its
// own, and would be reachable by anything on the AP.
import {
	wifiConnectNotification,
	wifiConnectParamsSchema,
	wifiRequestStateNotification,
	wifiScanNotification,
	wifiStateNotification,
	wifiStateParamsSchema
} from '#lib/pairing/remoteProtocol';
import {
	connectToNetwork,
	getNetworkState,
	isAvailable,
	scanNetworks,
	startHotspot,
	type NetworkState,
	type WifiNetwork
} from './wifi';
import { registerPhoneFrameHandler, sendToPhones } from './ws/relay';

// Everything here that isn't NetworkManager's own business. Scan results are
// cached because a scan takes seconds and every phone that opens the wifi
// screen wants the same list; `connecting` and `error` exist so a phone that
// reloads mid-join, or a second phone, sees the same thing as the one that
// started it.
type ProvisioningState = {
	available: boolean;
	connectingSsid: string | null;
	error: string | null;
	networks: WifiNetwork[] | null;
};

const state: ProvisioningState = {
	available: false,
	connectingSsid: null,
	error: null,
	networks: null
};

// What to report when NetworkManager can't be reached at all: the most
// conservative reading, rather than a field-by-field pile of fallbacks at the
// point of use.
const UNKNOWN_NETWORK = {
	mode: 'disconnected',
	ssid: null,
	online: false,
	ethernet: false
} satisfies Pick<NetworkState, 'mode' | 'ssid' | 'online' | 'ethernet'>;

async function currentNetwork() {
	return await getNetworkState().catch(() => UNKNOWN_NETWORK);
}

async function pushState() {
	const network = await currentNetwork();

	sendToPhones({
		jsonrpc: '2.0',
		method: wifiStateNotification.method,
		params: wifiStateParamsSchema.parse({
			available: state.available,
			mode: network.mode,
			ssid: network.ssid,
			online: network.online,
			ethernet: network.ethernet,
			connecting: state.connectingSsid !== null,
			connectingSsid: state.connectingSsid,
			error: state.error,
			networks: state.networks
		})
	});
}

async function handleScan() {
	try {
		state.networks = await scanNetworks();
	} catch (error) {
		state.error = error instanceof Error ? error.message : String(error);
	}
	await pushState();
}

async function handleConnect(rawParams: unknown) {
	const params = wifiConnectParamsSchema.parse(rawParams);

	state.connectingSsid = params.ssid;
	state.error = null;
	// Pushed before the attempt, not just after it: joining takes several
	// seconds, and the phone should show that it started rather than looking
	// like the tap did nothing.
	await pushState();

	const result = await connectToNetwork(params.ssid, params.password, params.hidden);

	state.connectingSsid = null;
	state.error = result.ok ? null : result.error;
	// A failed join left the radio disconnected with the hotspot already torn
	// down (it has to be, to attempt the join at all), which would strand the
	// phone with no way back in. Put the AP back up so the password can be
	// corrected and tried again.
	if (!result.ok) await startHotspot().catch(() => {});

	await pushState();
}

// Returning `true` consumes the frame so the relay doesn't forward it to the
// TV. Failures are swallowed into state rather than thrown: this runs on a
// socket message, where a rejection would have nowhere to go.
function handleWifiFrame(method: string, params: unknown): boolean {
	const handler = HANDLERS[method];
	if (!handler) return false;
	void handler(params).catch(async (error) => {
		state.connectingSsid = null;
		state.error = error instanceof Error ? error.message : String(error);
		await pushState().catch(() => {});
	});
	return true;
}

const HANDLERS: Record<string, (params: unknown) => Promise<void>> = {
	[wifiRequestStateNotification.method]: () => pushState(),
	[wifiScanNotification.method]: () => handleScan(),
	[wifiConnectNotification.method]: (params) => handleConnect(params)
};

/**
 * Called once at startup (src/api/handlers/register.ts). Registers the frame
 * handler and, if the device has no way to reach the network, brings up the
 * provisioning AP so a phone has something to connect to.
 */
// Ethernet counts: a wired device needs no provisioning, and raising an AP on it
// would be noise. So would raising one when the radio is already on a network,
// or when it is already serving the AP from a previous boot ('hotspot').
function needsProvisioning(network: Pick<NetworkState, 'mode' | 'online' | 'ethernet'>): boolean {
	return !network.ethernet && !network.online && network.mode === 'disconnected';
}

export async function startWifiProvisioning() {
	registerPhoneFrameHandler(handleWifiFrame);

	state.available = await isAvailable();
	if (!state.available) return;

	if (needsProvisioning(await currentNetwork())) await startHotspot().catch(() => {});
}
