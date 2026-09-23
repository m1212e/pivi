import { redirect } from '@sveltejs/kit';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { getActiveProfileUser } from '#api/activeProfile';
import { getLanAddress } from '#api/lan';
import { createPairingToken, isPairingTokenValid, PAIRING_TOKEN_TTL_MS } from '#api/pairing';
import { getTextDirection } from '#lib/paraglide/runtime';
import { paraglideMiddleware } from '#lib/paraglide/server';

const PAIRING_COOKIE = 'pairing_token';

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		// `event.request` is read-only in the type system, but paraglide needs
		// the de-localized request swapped in before `resolve` runs downstream.
		(event as { request: Request }).request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

// Pages no longer gate themselves with a `load` function, so /home's (and
// any app page's) "must have an active profile" check lives here instead.
function requiresActiveProfile(pathname: string): boolean {
	return pathname === '/home' || pathname.startsWith('/apps/') || pathname.startsWith('/play/');
}

const handleActiveProfile: Handle = async ({ event, resolve }) => {
	// Pivi is single-device/local-network, so "who's logged in" is one global
	// row in the DB rather than a per-browser session cookie.
	const user = await getActiveProfileUser();
	if (user) event.locals.user = user;

	if (!user && requiresActiveProfile(event.url.pathname)) {
		redirect(302, '/');
	}

	return resolve(event);
};

// GraphQL query resolvers (see #api/handlers/pairing) can't set cookies —
// SvelteKit only allows that from a `command`/form action or, as here, a
// hook — so the pairing token is minted once per request up front and just
// read back by the `pairing` query.
const handlePairing: Handle = ({ event, resolve }) => {
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

	const lanAddress = getLanAddress();
	event.locals.pairingToken = pairingToken;
	event.locals.remoteUrl = lanAddress
		? `http://${lanAddress}:${event.url.port}/remote/${pairingToken}`
		: null;

	return resolve(event);
};

export const handle: Handle = sequence(handleParaglide, handlePairing, handleActiveProfile);
