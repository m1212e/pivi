import { redirect } from '@sveltejs/kit';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { getActiveProfileUser } from '#api/activeProfile';
import { noteBrowserLocale } from '#api/apps/hostLocale';
import { handlePairing } from '#api/pairingHook';
import { getTextDirection } from '#lib/paraglide/runtime';
import { paraglideMiddleware } from '#lib/paraglide/server';
import { API_PREFIX, APPS_PREFIX, REMOTE_PREFIX, ROUTES, isPlayPath } from '#lib/routes';

// Only the TV's own pages say what language apps should use, not the paired
// phone's remote page or API calls.
const handleHostLocale: Handle = ({ event, resolve }) => {
	const { pathname } = event.url;
	if (!pathname.startsWith(REMOTE_PREFIX) && !pathname.startsWith(API_PREFIX)) {
		noteBrowserLocale(event.request.headers.get('accept-language'));
	}
	return resolve(event);
};

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
	return (
		pathname === ROUTES.home ||
		pathname === ROUTES.apps ||
		pathname.startsWith(APPS_PREFIX) ||
		isPlayPath(pathname)
	);
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

export const handle: Handle = sequence(
	handleHostLocale,
	handleParaglide,
	handlePairing,
	handleActiveProfile
);
