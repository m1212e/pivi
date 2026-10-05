// Login via youtubei.js's built-in device-code flow (see innertube.ts for
// why this avoids needing our own registered OAuth client). This is a
// manual action (a "Sign in" button — see main.ts), not something that
// gates activation: trending/search are public and work without it. Only a
// future personalized feature (subscriptions, resume, private playlists)
// would actually need a signed-in session.
//
// There's no dedicated sign-in protocol on the host side (see
// #lib/apps/manifest's featureSchema) — this app owns the whole flow and
// reports it through the same 'screen' content it already publishes for
// everything else: `onStatus` below feeds main.ts the device code to show,
// and the host's generic `openOnPhone` button action (see dashboard.ts)
// is what actually gets the verification URL in front of the user.
import type { DeviceAndUserCode } from 'youtubei.js';
import { innertube } from './innertube';

export type DeviceCodeStatus = 'pending' | 'complete' | 'expired' | 'error';

export type DeviceCodeAuth = {
	verificationUrl: string;
	userCode: string;
	status: DeviceCodeStatus;
};

export function isSignedIn(): boolean {
	return innertube.session.logged_in;
}

export function beginSignIn(onStatus: (auth: DeviceCodeAuth) => void): Promise<void> {
	if (isSignedIn()) return Promise.resolve();

	return new Promise((resolve, reject) => {
		let lastCode: DeviceAndUserCode | undefined;
		const report = (status: DeviceCodeStatus) => {
			if (!lastCode) return;
			onStatus({
				verificationUrl: lastCode.verification_url,
				userCode: lastCode.user_code,
				status
			});
		};

		const onPending = (data: DeviceAndUserCode) => {
			lastCode = data;
			report('pending');
		};
		const onAuth = () => {
			cleanup();
			report('complete');
			resolve();
		};
		const onError = (err: unknown) => {
			cleanup();
			report('error');
			reject(err instanceof Error ? err : new Error(String(err)));
		};
		function cleanup() {
			innertube.session.off('auth-pending', onPending);
			innertube.session.off('auth', onAuth);
			innertube.session.off('auth-error', onError);
		}

		innertube.session.on('auth-pending', onPending);
		innertube.session.once('auth', onAuth);
		innertube.session.once('auth-error', onError);
		innertube.session.signIn().catch(onError);
	});
}
