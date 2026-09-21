import type { PageServerLoad } from './$types';

// handleActiveProfile (see hooks.server.ts) already redirects away from
// /home when there's no active profile, so locals.user is guaranteed here.
export const load: PageServerLoad = ({ locals }) => ({ userId: locals.user!.id });
