import type { User } from 'better-auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			// Sourced from the global `active_profile` row (#lib/server/activeProfile),
			// not a per-browser session — see hooks.server.ts.
			// `username`/`displayUsername` come from better-auth's `username` plugin,
			// which isn't reflected in the base `User` type.
			user?: User & { username?: string | null; displayUsername?: string | null };
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
