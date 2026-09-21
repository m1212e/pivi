import { client } from '#lib/api/rumbleClient/client';

export function getPairing() {
	return client.query.pairing({ pairingToken: true, remoteUrl: true });
}
