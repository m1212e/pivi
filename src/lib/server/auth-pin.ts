import { serializeSignedCookie } from 'better-call';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { auth } from '#lib/server/auth';

const PIN_PATTERN = /^\d{4}$/;
const PIN_EMAIL_DOMAIN = 'pivi.local';
const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // matches better-auth's default 7-day session

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

// Re-signs a raw session token (as returned by signUpEmail/signInUsername) into
// the same cookie better-auth's own handler would set, so the pairing bridge
// can hand a phone-issued session to the TV without going through HTTP itself.
export function sessionCookieFor(token: string) {
	return serializeSignedCookie(SESSION_COOKIE_NAME, token, BETTER_AUTH_SECRET, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: SESSION_COOKIE_MAX_AGE
	});
}
