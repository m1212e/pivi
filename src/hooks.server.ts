import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { auth } from '#lib/server/auth';
import { getActiveProfileUser } from '#lib/server/activeProfile';
import { startPairingRelay } from '#lib/server/ws/relay';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '#lib/paraglide/runtime';
import { paraglideMiddleware } from '#lib/paraglide/server';

if (!building) startPairingRelay();

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

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = sequence(handleParaglide, handleActiveProfile);
