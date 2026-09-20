import { db } from '#lib/server/db';
import { user } from '#lib/server/db/schema';
import { isPairingPending } from '#lib/server/pairing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const profiles = await db
		.select({
			id: user.id,
			username: user.username,
			displayUsername: user.displayUsername,
			image: user.image
		})
		.from(user)
		.orderBy(user.createdAt);

	return { profiles, expired: !isPairingPending(params.token) };
};
