import { freshQuery } from '#lib/api/freshQuery';

/**
 * Polled by the setup and home screens to notice server side changes, like the
 * phone finishing a wifi join. Always a real round trip, same reasoning as getPairing.
 */
export function getNetworkStatus() {
	return freshQuery.network({
		available: true,
		mode: true,
		ssid: true,
		online: true,
		ethernet: true,
		hotspotSsid: true,
		hotspotPassword: true
	});
}
