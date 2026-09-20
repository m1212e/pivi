import type { User, Session } from 'better-auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			// `username`/`displayUsername` come from better-auth's `username` plugin,
			// which isn't reflected in the base `User` type.
			user?: User & { username?: string | null; displayUsername?: string | null };
			session?: Session;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
