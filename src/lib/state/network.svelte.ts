import { urqlClient } from '#lib/api/client';

/** What the setup and home screens need to show connectivity and offer the hotspot. */
export type NetworkStatus = {
	available: boolean;
	mode: string;
	ssid: string | null;
	online: boolean;
	ethernet: boolean;
	hotspotSsid: string;
	hotspotPassword: string;
};

const NETWORK_QUERY = /* GraphQL */ `
	query PiviNetwork {
		network {
			available
			mode
			ssid
			online
			ethernet
			hotspotSsid
			hotspotPassword
		}
	}
`;

/**
 * Polled by the setup and home screens to notice server side changes, like the
 * phone finishing a wifi join. Always a real round trip, same reasoning as getPairing.
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
	const result = await urqlClient
		.query<{ network: NetworkStatus }>(NETWORK_QUERY, {}, { requestPolicy: 'network-only' })
		.toPromise();
	if (result.error) throw result.error;
	return result.data!.network;
}
