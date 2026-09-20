import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { username } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db';
import * as schema from '#lib/server/db/schema';

// There is no email step: signup synthesizes a throwaway address from the
// username (better-auth's core user schema requires a unique `email`), and
// the "password" is a 4-digit PIN. See #lib/server/auth-pin for the
// username+PIN sign-up/sign-in wrappers used instead of the raw email APIs.
export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	// drizzle-orm v1 (required by @m1212e/rumble) restructured where the adapter's
	// v0-era `db._.fullSchema` fallback reads from, so the schema is passed explicitly.
	database: drizzleAdapter(db, { provider: 'pg', schema }),
	emailAndPassword: { enabled: true, minPasswordLength: 4, maxPasswordLength: 4 },
	user: { deleteUser: { enabled: true } },
	plugins: [
		username(),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
