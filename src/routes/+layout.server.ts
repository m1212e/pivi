import { createPairingToken } from '#lib/server/pairing';
import { getLanAddress } from '#lib/server/lan';
import type { LayoutServerLoad } from './$types';

const PAIRING_COOKIE = 'pairing_token';

export const load: LayoutServerLoad = ({ cookies, url }) => {
	let pairingToken = cookies.get(PAIRING_COOKIE);
	if (!pairingToken) {
		pairingToken = createPairingToken();
		cookies.set(PAIRING_COOKIE, pairingToken, { path: '/', httpOnly: true, sameSite: 'lax' });
	}

	const lanAddress = getLanAddress();
	const remoteUrl = lanAddress ? `http://${lanAddress}:${url.port}/remote/${pairingToken}` : null;

	return { pairingToken, remoteUrl };
};
