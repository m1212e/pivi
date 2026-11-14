// Credentials for a registry, and the token dance the distribution API asks for.
//
// Where credentials come from, first match wins:
//   1. PIVI_REGISTRY_USERNAME and PIVI_REGISTRY_PASSWORD (CI, e.g. a GitHub token),
//      for the registry being published to only: pulling the base image from
//      another registry must not send them there
//   2. the `auths` of the docker config (`docker login` writes them), from
//      $DOCKER_CONFIG/config.json or ~/.docker/config.json
// Credential helpers (credsStore, credHelpers) are not supported: use 1 then.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Credentials = { username: string; password: string };

function dockerConfigAuth(registry: string): Credentials | undefined {
	const dir = process.env.DOCKER_CONFIG || join(homedir(), '.docker');
	let config: { auths?: Record<string, { auth?: string; username?: string; password?: string }> };
	try {
		config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
	} catch {
		return undefined;
	}
	const keys =
		registry === 'docker.io'
			? ['https://index.docker.io/v1/', 'index.docker.io', 'docker.io', 'registry-1.docker.io']
			: [registry, `https://${registry}`, `http://${registry}`];
	for (const key of keys) {
		const entry = config.auths?.[key];
		if (entry?.auth) {
			const decoded = Buffer.from(entry.auth, 'base64').toString('utf8');
			const colon = decoded.indexOf(':');
			if (colon > 0)
				return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
		}
		if (entry?.username && entry.password)
			return { username: entry.username, password: entry.password };
	}
	return undefined;
}

/** Credentials from the docker config. */
export function findCredentials(registry: string): Credentials | undefined {
	return dockerConfigAuth(registry);
}

/** Credentials for the registry being published to: the environment first, then the docker config. */
export function findPublishCredentials(registry: string): Credentials | undefined {
	const username = process.env.PIVI_REGISTRY_USERNAME;
	const password = process.env.PIVI_REGISTRY_PASSWORD;
	if (username && password) return { username, password };
	return dockerConfigAuth(registry);
}

export type Challenge =
	{ scheme: 'basic' } | { scheme: 'bearer'; realm: string; service?: string; scope?: string };

/** Parses a WWW-Authenticate header, e.g. `Bearer realm="https://…",service="…",scope="…"`. */
export function parseChallenge(header: string | null): Challenge | undefined {
	if (!header) return undefined;
	const [scheme = '', ...rest] = header.trim().split(/\s+/);
	if (scheme.toLowerCase() === 'basic') return { scheme: 'basic' };
	if (scheme.toLowerCase() !== 'bearer') return undefined;
	const params: Record<string, string> = {};
	for (const [, key, value] of rest.join(' ').matchAll(/(\w+)="([^"]*)"/g)) params[key!] = value!;
	if (!params.realm) return undefined;
	return { scheme: 'bearer', realm: params.realm, service: params.service, scope: params.scope };
}

export const basicHeader = (c: Credentials) =>
	`Basic ${Buffer.from(`${c.username}:${c.password}`).toString('base64')}`;

/** Exchanges credentials (or nothing, for public pulls) for a bearer token for these scopes. */
export async function fetchToken(
	challenge: Extract<Challenge, { scheme: 'bearer' }>,
	scopes: string[],
	credentials: Credentials | undefined
): Promise<string> {
	const url = new URL(challenge.realm);
	if (challenge.service) url.searchParams.set('service', challenge.service);
	for (const scope of scopes) url.searchParams.append('scope', scope);
	const response = await fetch(url, {
		headers: credentials ? { authorization: basicHeader(credentials) } : {},
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) {
		const hint = credentials
			? 'check the credentials'
			: 'no credentials found, see `pivi-app publish --help`';
		throw new Error(`The registry refused a token (HTTP ${response.status}): ${hint}`);
	}
	const body = (await response.json()) as { token?: string; access_token?: string };
	const token = body.token ?? body.access_token;
	if (!token) throw new Error('The registry answered without a token');
	return token;
}
