import { randomBytes } from 'node:crypto';

// The pairing token is just a room id for the WS relay (#lib/server/ws/relay)
// — the phone remote and its TV both connect to `/<token>` and get bridged.
// There's no server-side state to track beyond the random id itself; a stale
// token simply has no live TV listening on it.
export function createPairingToken() {
	return randomBytes(16).toString('hex');
}
