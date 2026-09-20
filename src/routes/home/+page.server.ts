import { redirect } from '@sveltejs/kit';
import { clearActiveProfile } from '#lib/server/activeProfile';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (!event.locals.user) return redirect(302, '/');
	return { user: event.locals.user };
};

export const actions: Actions = {
	signOut: async () => {
		await clearActiveProfile();
		return redirect(302, '/');
	}
};
