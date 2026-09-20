import { fail, redirect } from '@sveltejs/kit';
import { registerWithPin, sessionCookieFor, InvalidPinError } from '#lib/server/auth-pin';
import { isPairingPending, resolvePairing } from '#lib/server/pairing';
import { APIError } from 'better-auth/api';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		if (!isPairingPending(event.params.token)) return fail(410, { message: 'QR code expired' });

		const formData = await event.request.formData();
		const username = formData.get('username')?.toString().trim() ?? '';
		const pin = formData.get('pin')?.toString() ?? '';

		if (!username) return fail(400, { message: 'Pick a username' });

		try {
			const result = await registerWithPin(username, pin);
			resolvePairing(event.params.token, await sessionCookieFor(result.token));
		} catch (err) {
			if (err instanceof InvalidPinError) return fail(400, { message: err.message });
			if (err instanceof APIError)
				return fail(400, { message: err.message || 'Could not create profile' });
			return fail(500, { message: 'Unexpected error' });
		}

		return redirect(302, `/remote/${event.params.token}/success`);
	}
};
