import type { Handle } from '@sveltejs/kit/hooks';
import { REMOTE_PREFIX, isRemotePath } from '#lib/routes';
import { getLanAddressOrHostname } from './lan';
import { createPairingToken, isPairingTokenValid, PAIRING_TOKEN_TTL_MS } from './pairing';

const PAIRING_COOKIE = 'pairing_token';

// GraphQL query resolvers (see #api/handlers/pairing) can't set cookies —
// SvelteKit only allows that from a `command`/form action or, as here, a
// hook — so the pairing token is minted once per request up front and just
// read back by the `pairing` query.
export const handlePairing: Handle = ({ event, resolve }) => {
	// The remote page is the one path the LAN can reach (deploy/pivi-server.mjs).
	// Minting here would hand any device on the network a valid token in the
	// Set-Cookie header, so only the TV's own pages get one.
	if (isRemotePath(event.url.pathname)) return resolve(event);

	let pairingToken = event.cookies.get(PAIRING_COOKIE);
	// The cookie can outlive the token's server-side TTL (idle screen, dev
	// server restart wiping the in-memory token map, etc.) — re-mint rather
	// than keep handing out a token the server no longer recognizes.
	if (!pairingToken || !isPairingTokenValid(pairingToken)) {
		pairingToken = createPairingToken();
		event.cookies.set(PAIRING_COOKIE, pairingToken, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: PAIRING_TOKEN_TTL_MS / 1000
		});
	}

	const lanAddress = getLanAddressOrHostname();
	event.locals.pairingToken = pairingToken;
	event.locals.remoteUrl = lanAddress
		? `http://${lanAddress}:${event.url.port}${REMOTE_PREFIX}#${pairingToken}`
		: null;

	return resolve(event);
};
