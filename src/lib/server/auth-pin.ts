import { auth } from '#lib/server/auth';

const PIN_PATTERN = /^\d{4}$/;
const PIN_EMAIL_DOMAIN = 'pivi.local';

export class InvalidPinError extends Error {
	constructor() {
		super('PIN must be exactly 4 digits');
	}
}

function assertValidPin(pin: string) {
	if (!PIN_PATTERN.test(pin)) throw new InvalidPinError();
}

// better-auth's core user schema still requires a unique `email`; this
// synthesizes one from the username so callers never have to think about it.
function emailForUsername(username: string) {
	return `${username}@${PIN_EMAIL_DOMAIN}`;
}

export function registerWithPin(username: string, pin: string) {
	assertValidPin(pin);

	return auth.api.signUpEmail({
		body: {
			email: emailForUsername(username),
			password: pin,
			name: username,
			username
		}
	});
}

export function loginWithPin(username: string, pin: string) {
	assertValidPin(pin);

	return auth.api.signInUsername({
		body: { username, password: pin }
	});
}
