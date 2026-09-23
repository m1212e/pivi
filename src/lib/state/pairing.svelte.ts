import { urqlClient } from '#lib/api/client';

type Pairing = { pairingToken: string; remoteUrl: string | null };

const PAIRING_QUERY = /* GraphQL */ `
	query PivPairing {
		pairing {
			pairingToken
			remoteUrl
		}
	}
`;

// Bypasses the generated client's client.query.pairing() on purpose: that
// helper resolves as soon as the first result comes in, which under
// 'cache-and-network' is the (possibly minutes-old) cached one -- exactly
// wrong for a poll whose entire point is noticing the pairing token expired
// server-side and picking up the newly-minted one. requestPolicy:
// 'network-only' plus urql's own .toPromise() (which filters out `stale`
// results) guarantees this always waits for a real round trip.
export async function getPairing(): Promise<Pairing> {
	const result = await urqlClient
		.query<{ pairing: Pairing }>(PAIRING_QUERY, {}, { requestPolicy: 'network-only' })
		.toPromise();
	if (result.error) throw result.error;
	return result.data!.pairing;
}
