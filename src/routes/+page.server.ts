import { db } from '#lib/server/db';
import { user } from '#lib/server/db/schema';
import { createPairing, isPairingPending } from '#lib/server/pairing';
import { getLanAddress } from '#lib/server/lan';
import type { PageServerLoad } from './$types';

const PAIRING_COOKIE = 'pairing_token';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const profiles = await db
		.select({
			id: user.id,
			username: user.username,
			displayUsername: user.displayUsername,
			image: user.image
		})
		.from(user)
		.orderBy(user.createdAt);

	let pairingToken = cookies.get(PAIRING_COOKIE);
	if (!pairingToken || !isPairingPending(pairingToken)) {
		pairingToken = createPairing();
		cookies.set(PAIRING_COOKIE, pairingToken, { path: '/', httpOnly: true, sameSite: 'lax' });
	}

	const lanAddress = getLanAddress();
	const remoteUrl = lanAddress ? `http://${lanAddress}:${url.port}/remote/${pairingToken}` : null;

	return { profiles, pairingToken, remoteUrl };
};
