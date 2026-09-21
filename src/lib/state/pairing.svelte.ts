import { client } from '#lib/api/rumbleClient/client';

let pairing = $state<{ pairingToken: string; remoteUrl: string | null }>();

// The root layout and the profile-switcher page both need the pairing token;
// memoized so the query only round-trips once per page load.
export async function getPairing() {
	if (!pairing) {
		pairing = await client.query.pairing({ pairingToken: true, remoteUrl: true });
	}
	return pairing;
}
