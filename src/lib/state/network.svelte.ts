import { urqlClient } from '#lib/api/client';

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

// Same reasoning as state/pairing.svelte.ts's getPairing: this is polled
// precisely to notice a change the server made (the phone joined a network, so
// the setup screen should get out of the way), and the generated client's
// cache-and-network helper would happily answer from a cached result that
// predates it. 'network-only' plus .toPromise() means every call is a real
// round trip.
export async function getNetworkStatus(): Promise<NetworkStatus> {
	const result = await urqlClient
		.query<{ network: NetworkStatus }>(NETWORK_QUERY, {}, { requestPolicy: 'network-only' })
		.toPromise();
	if (result.error) throw result.error;
	return result.data!.network;
}
