import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { getActiveProfileUser } from '#api/activeProfile';
import { startDeviceCleanupSchedule } from '#api/deviceCleanup';
import { getLanAddress } from '#api/lan';
import { createPairingToken } from '#api/pairing';
import { startPairingRelay } from '#api/ws/relay';
import { getTextDirection } from '#lib/paraglide/runtime';
import { paraglideMiddleware } from '#lib/paraglide/server';

const PAIRING_COOKIE = 'pairing_token';

if (!building) {
	startPairingRelay();
	startDeviceCleanupSchedule();
}

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

const handleActiveProfile: Handle = async ({ event, resolve }) => {
	// Pivi is single-device/local-network, so "who's logged in" is one global
	// row in the DB rather than a per-browser session cookie.
	const user = await getActiveProfileUser();
	if (user) event.locals.user = user;

	// Pages no longer gate themselves with a `load` function, so /home's
	// "must have an active profile" check lives here instead.
	if (!user && event.url.pathname === '/home') redirect(302, '/');

	return resolve(event);
};

// GraphQL query resolvers (see #api/handlers/pairing) can't set cookies —
// SvelteKit only allows that from a `command`/form action or, as here, a
// hook — so the pairing token is minted once per request up front and just
// read back by the `pairing` query.
const handlePairing: Handle = ({ event, resolve }) => {
	let pairingToken = event.cookies.get(PAIRING_COOKIE);
	if (!pairingToken) {
		pairingToken = createPairingToken();
		event.cookies.set(PAIRING_COOKIE, pairingToken, { path: '/', httpOnly: true, sameSite: 'lax' });
	}

	const lanAddress = getLanAddress();
	event.locals.pairingToken = pairingToken;
	event.locals.remoteUrl = lanAddress
		? `http://${lanAddress}:${event.url.port}/remote/${pairingToken}`
		: null;

	return resolve(event);
};

export const handle: Handle = sequence(handleParaglide, handlePairing, handleActiveProfile);
