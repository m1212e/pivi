// Sign-in with Twitch's own TV app login, the device code flow behind
// twitch.tv/activate: the TV shows a code, the person enters it on their
// phone, and the TV app's public client id gets a token for that account. The
// same trick the YouTube app plays with the YouTube TV client (innertube.ts),
// so there is no developer app to register and no client secret to ship.
//
// Tokens live in the storage volume, so they are per profile and survive
// restarts. Nothing else about the account is stored, everything personal is
// asked of Twitch when it's shown.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { storagePath } from '@pivi/sdk/storage';

/** The Twitch Android TV app's client id. GQL requests with its tokens must send it too. */
export const TV_CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';

const ID_BASE = 'https://id.twitch.tv/oauth2';
const FILE = storagePath('twitch-auth.json');
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
// Refreshed this long before it runs out, so a request never races the expiry.
const EXPIRY_MARGIN_MS = 5 * 60_000;

// GQL no longer lists an account's follows (raw `follows` queries answer
// "service error"), the documented Helix endpoint does, but only with this
// scope. The TV client grants it like any other.
const SCOPES = ['user:read:follows'];

type Tokens = {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	scopes?: string[];
};

let tokens: Tokens | undefined;

export type DeviceCodeStatus = 'pending' | 'expired' | 'error';

/** What the TV shows while a sign-in waits for the phone. */
export type DeviceCodeAuth = {
	// Where to enter the code by hand.
	verificationUrl: string;
	// The same page with the code filled in, for the phone.
	phoneUrl: string;
	userCode: string;
	status: DeviceCodeStatus;
};

type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string[];
};

function toTokens(body: TokenResponse): Tokens {
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
		scopes: body.scope
	};
}

async function save(next: Tokens | undefined) {
	tokens = next;
	try {
		if (next) await writeFile(FILE, JSON.stringify(next));
		else await rm(FILE, { force: true });
	} catch {
		// Without storage the session just doesn't survive a restart.
	}
}

function isTokens(value: unknown): value is Tokens {
	return (
		typeof value === 'object' && value !== null && typeof (value as Tokens).accessToken === 'string'
	);
}

/** Restores the profile's session, call before anything checks isSignedIn. */
export async function loadSession() {
	try {
		const parsed: unknown = JSON.parse(await readFile(FILE, 'utf8'));
		// A session from before SCOPES can't read follows, signing in again
		// fixes that, so it counts as signed out.
		tokens =
			isTokens(parsed) && SCOPES.every((s) => parsed.scopes?.includes(s)) ? parsed : undefined;
	} catch {
		tokens = undefined;
	}
}

export function isSignedIn(): boolean {
	return !!tokens;
}

function postForm(path: string, form: Record<string, string>): Promise<Response> {
	return fetch(`${ID_BASE}/${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(form),
		signal: AbortSignal.timeout(10_000)
	});
}

type RefreshResult = 'ok' | 'invalid' | 'transient';

let refreshing: Promise<RefreshResult> | undefined;

/**
 * Renews the tokens. 'invalid' only when Twitch definitively refused the
 * refresh token (400/401, e.g. invalid_grant), 'transient' for network errors,
 * timeouts and 5xx, which keep the session for a later retry. Single-flight:
 * concurrent callers share one request, so a rotated refresh token is never
 * sent twice.
 */
function refresh(): Promise<RefreshResult> {
	refreshing ??= runRefresh().finally(() => (refreshing = undefined));
	return refreshing;
}

async function runRefresh(): Promise<RefreshResult> {
	const current = tokens;
	if (!current?.refreshToken) return current ? 'invalid' : 'transient';
	let response: Response;
	try {
		response = await postForm('token', {
			client_id: TV_CLIENT_ID,
			grant_type: 'refresh_token',
			refresh_token: current.refreshToken
		});
	} catch {
		return 'transient';
	}
	if (response.status === 400 || response.status === 401) return 'invalid';
	if (!response.ok) return 'transient';
	let body: TokenResponse;
	try {
		body = (await response.json()) as TokenResponse;
	} catch {
		return 'transient';
	}
	if (typeof body.access_token !== 'string') return 'transient';
	// Signed out (or signed in anew) while the request ran: don't resurrect.
	if (tokens !== current) return tokens ? 'ok' : 'invalid';
	const next = toTokens(body);
	// Twitch may leave the refresh token out when it didn't rotate it.
	next.refreshToken ??= current.refreshToken;
	next.scopes ??= current.scopes;
	await save(next);
	return 'ok';
}

/**
 * The token to send, refreshed first when it's about to run out. Undefined
 * when signed out, or when Twitch refused to renew the session, which signs
 * out. A transient refresh failure keeps the session and the current token,
 * the next call retries.
 */
export async function accessToken(): Promise<string | undefined> {
	if (!tokens) return undefined;
	if (tokens.expiresAt && Date.now() > tokens.expiresAt - EXPIRY_MARGIN_MS) {
		if ((await refresh()) === 'invalid') await save(undefined);
	}
	return tokens?.accessToken;
}

/**
 * Called when Twitch rejected the token anyway (revoked, or expired without
 * an expiry we knew of). True when a refresh got a new one to retry with.
 * Signs out only when the refresh was definitively refused.
 */
export async function recoverFromRejection(): Promise<boolean> {
	const result = await refresh();
	if (result === 'ok') return true;
	if (result === 'invalid') await save(undefined);
	return false;
}

export async function signOut() {
	const token = tokens?.accessToken;
	await save(undefined);
	if (token) {
		// Best effort, the token is forgotten here either way.
		await postForm('revoke', { client_id: TV_CLIENT_ID, token }).catch(() => {});
	}
}

type DeviceResponse = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let signingIn: Promise<void> | undefined;

/**
 * Runs the device code flow, reporting the code through `onStatus`, and
 * resolves once the person approved it on their phone. Rejects when the code
 * expired or Twitch refused. Only one runs at a time.
 */
export function beginSignIn(onStatus: (auth: DeviceCodeAuth) => void): Promise<void> {
	signingIn ??= runSignIn(onStatus).finally(() => (signingIn = undefined));
	return signingIn;
}

async function runSignIn(onStatus: (auth: DeviceCodeAuth) => void) {
	// GQL takes the TV client's tokens without scopes, SCOPES are for Helix.
	const response = await postForm('device', {
		client_id: TV_CLIENT_ID,
		scopes: SCOPES.join(' ')
	});
	if (!response.ok) throw new Error(`Twitch device login answered ${response.status}`);
	const device = (await response.json()) as DeviceResponse;
	const report = (status: DeviceCodeStatus) =>
		onStatus({
			verificationUrl: device.verification_uri,
			phoneUrl: `${device.verification_uri}?device-code=${encodeURIComponent(device.user_code)}`,
			userCode: device.user_code,
			status
		});
	report('pending');

	const deadline = Date.now() + device.expires_in * 1000;
	let interval = Math.max(device.interval, 1) * 1000;
	while (Date.now() < deadline) {
		await sleep(interval);
		const poll = await postForm('token', {
			client_id: TV_CLIENT_ID,
			device_code: device.device_code,
			grant_type: DEVICE_GRANT
		});
		if (poll.ok) {
			await save(toTokens((await poll.json()) as TokenResponse));
			return;
		}
		const { message } = (await poll.json().catch(() => ({}))) as { message?: string };
		if (message === 'slow_down') interval += 5000;
		else if (message !== 'authorization_pending') {
			report('error');
			throw new Error(`Twitch sign-in failed: ${message ?? poll.status}`);
		}
	}
	report('expired');
	throw new Error('The sign-in code expired');
}
