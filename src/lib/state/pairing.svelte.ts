import { urqlClient } from '#lib/api/client';

/** The data behind the pairing QR code and remote link. */
type Pairing = { pairingToken: string; remoteUrl: string | null };

const PAIRING_QUERY = /* GraphQL */ `
	query PivPairing {
		pairing {
			pairingToken
			remoteUrl
		}
	}
`;

/**
 * Polled by the setup and login screens so an expired pairing token gets
 * replaced. Skips the generated client's helper, which would resolve with a
 * possibly minutes old cached result first.
 */
export async function getPairing(): Promise<Pairing> {
	const result = await urqlClient
		.query<{ pairing: Pairing }>(PAIRING_QUERY, {}, { requestPolicy: 'network-only' })
		.toPromise();
	if (result.error) throw result.error;
	return result.data!.pairing;
}
