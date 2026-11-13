import { freshQuery } from '#lib/api/freshQuery';

/**
 * Polled by the setup and login screens so an expired pairing token gets
 * replaced. Uses freshQuery since client.query would resolve with a possibly
 * minutes old cached result first.
 */
export function getPairing() {
	return freshQuery.pairing({ pairingToken: true, remoteUrl: true });
}
