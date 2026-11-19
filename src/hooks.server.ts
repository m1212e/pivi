import { dev } from '$app/env';
import { redirect } from '@sveltejs/kit';
import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { getActiveProfileUser } from '#api/activeProfile';
import { noteHostLocale } from '#api/apps/hostLocale';
import { lowPower } from '#api/lowPower';
import { activeProfileLocale } from '#api/profileLocale';
import { handlePairing } from '#api/pairingHook';
import { defineCustomServerStrategy, getTextDirection } from '#lib/paraglide/runtime';
import { paraglideMiddleware } from '#lib/paraglide/server';
import { API_PREFIX, APPS_PREFIX, REMOTE_PREFIX, ROUTES, isPlayPath } from '#lib/routes';

// Only the TV's own pages say what language apps should use, not the paired
// phone's remote page or API calls.
const isTvPage = (pathname: string) =>
	!pathname.startsWith(REMOTE_PREFIX) && !pathname.startsWith(API_PREFIX);

// The logged in profile's language wins on the TV. The phone remote keeps its
// own browser's language: it may be someone else's phone.
defineCustomServerStrategy('custom-profile', {
	getLocale: (request) =>
		request && isTvPage(new URL(request.url).pathname) ? activeProfileLocale() : undefined
});

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		// Apps follow the language this page is shown in (see hostLocale.ts).
		if (isTvPage(event.url.pathname)) {
			noteHostLocale(locale, event.request.headers.get('accept-language'));
		}
		// `event.request` is read-only in the type system, but paraglide needs
		// the de-localized request swapped in before `resolve` runs downstream.
		(event as { request: Request }).request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
					// The phone remote is never the weak device, only the TV can be.
					.replace('%pivi.perf%', lowPower && isTvPage(event.url.pathname) ? 'low' : 'full')
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

// Backstop for the LAN filter in deploy/pivi-server.mjs: whatever slips past
// it, a non-loopback client may only ever reach the phone remote and its assets.
const LAN_ALLOWED = [REMOTE_PREFIX, '/_app/immutable/', '/_app/version.json'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const handleLanBoundary: Handle = ({ event, resolve }) => {
	if (dev) return resolve(event);
	let address: string;
	try {
		address = event.getClientAddress();
	} catch {
		return resolve(event);
	}
	const { pathname } = event.url;
	if (!LOOPBACK.has(address) && !LAN_ALLOWED.some((prefix) => pathname.startsWith(prefix))) {
		return new Response('Not found', { status: 404 });
	}
	return resolve(event);
};

// Closes off whole classes of injection (plugins, framing, <base>, form
// posts elsewhere) without restricting what the UI needs: SvelteKit's inline
// bootstrap script and Svelte's inline styles, app-provided images and media
// from any host, and the pairing socket on another port of the same host.
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	'img-src * data: blob:',
	'media-src * blob:',
	"font-src 'self' data:",
	"connect-src 'self' ws: wss:",
	"worker-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'"
].join('; ');

const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (!dev && !response.headers.has('content-security-policy')) {
		try {
			response.headers.set('Content-Security-Policy', CSP);
			response.headers.set('X-Content-Type-Options', 'nosniff');
			response.headers.set('Referrer-Policy', 'no-referrer');
		} catch {
			// Immutable headers (a passed-through fetch response): leave it be.
		}
	}
	return response;
};

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
	handleLanBoundary,
	handleSecurityHeaders,
	handleParaglide,
	handlePairing,
	handleActiveProfile
);
