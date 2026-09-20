import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db';
import { user } from '#lib/server/db/schema';
import { loginWithPin, InvalidPinError } from '#lib/server/auth-pin';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const profile = await db.query.user.findFirst({
		columns: { id: true, username: true, displayUsername: true, image: true },
		where: eq(user.username, params.username)
	});

	if (!profile) error(404, 'Profile not found');

	return { profile };
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const pin = formData.get('pin')?.toString() ?? '';

		try {
			await loginWithPin(event.params.username, pin);
		} catch (err) {
			if (err instanceof InvalidPinError) return fail(400, { message: err.message });
			if (err instanceof APIError) return fail(400, { message: 'Wrong PIN' });
			return fail(500, { message: 'Unexpected error' });
		}

		return redirect(302, '/home');
	}
};
