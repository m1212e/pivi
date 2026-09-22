// Login via youtubei.js's built-in device-code flow (see innertube.ts for
// why this avoids needing our own registered OAuth client). This is a
// manual action (a "Sign in" button — see main.ts), not something that
// gates activation: trending/search are public and work without it. Only a
// future personalized feature (subscriptions, resume, private playlists)
// would actually need a signed-in session.
import type { DeviceAndUserCode } from 'youtubei.js';
import { publishAuthNotification } from '#lib/plugins/host';
import { deviceCodeAuthSchema } from '#lib/plugins/auth';
import { manifest } from './manifest';
import { connection } from './connection';
import { innertube } from './innertube';

function publish(data: DeviceAndUserCode, status: 'pending' | 'complete' | 'expired' | 'error') {
	connection.sendNotification(
		publishAuthNotification,
		deviceCodeAuthSchema.parse({
			pluginId: manifest.id,
			verificationUrl: data.verification_url,
			userCode: data.user_code,
			expiresInSeconds: data.expires_in,
			pollIntervalSeconds: data.interval,
			status
		})
	);
}

export function isSignedIn(): boolean {
	return innertube.session.logged_in;
}

export function beginSignIn(): Promise<void> {
	if (isSignedIn()) return Promise.resolve();

	return new Promise((resolve, reject) => {
		let lastCode: DeviceAndUserCode | undefined;

		const onPending = (data: DeviceAndUserCode) => {
			lastCode = data;
			publish(data, 'pending');
		};
		const onAuth = () => {
			cleanup();
			if (lastCode) publish(lastCode, 'complete');
			resolve();
		};
		const onError = (err: unknown) => {
			cleanup();
			if (lastCode) publish(lastCode, 'error');
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
