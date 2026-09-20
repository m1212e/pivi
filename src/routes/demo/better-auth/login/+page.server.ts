import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import type { PageServerLoad } from './$types';
import { registerWithPin, loginWithPin, InvalidPinError } from '#lib/server/auth-pin';
import { APIError } from 'better-auth/api';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/demo/better-auth');
	}
	return {};
};

export const actions: Actions = {
	signIn: async (event) => {
		const formData = await event.request.formData();
		const username = formData.get('username')?.toString() ?? '';
		const pin = formData.get('pin')?.toString() ?? '';

		try {
			await loginWithPin(username, pin);
		} catch (error) {
			if (error instanceof InvalidPinError) return fail(400, { message: error.message });
			if (error instanceof APIError)
				return fail(400, { message: error.message || 'Sign in failed' });
			return fail(500, { message: 'Unexpected error' });
		}

		return redirect(302, '/demo/better-auth');
	},
	signUp: async (event) => {
		const formData = await event.request.formData();
		const username = formData.get('username')?.toString() ?? '';
		const pin = formData.get('pin')?.toString() ?? '';

		try {
			await registerWithPin(username, pin);
		} catch (error) {
			if (error instanceof InvalidPinError) return fail(400, { message: error.message });
			if (error instanceof APIError)
				return fail(400, { message: error.message || 'Registration failed' });
			return fail(500, { message: 'Unexpected error' });
		}

		return redirect(302, '/demo/better-auth');
	}
};
