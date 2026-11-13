import type { user } from '#api/db/schema';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			// Sourced from the global `active_profile` row (#api/handlers/activeProfile),
			// not a per-browser session — see hooks.server.ts.
			user?: typeof user.$inferSelect;
			// Set in hooks.server.ts for the TV's own pages, never for the remote
			// page. See the comment on handlePairing there.
			pairingToken?: string;
			remoteUrl?: string | null;
		}

		// interface Error {}
		// interface PageData {}
		interface PageState {
			// The app whose tile asked whether to update first, see AppCard.
			appUpdatePrompt?: string;
		}
		// interface Platform {}
	}
}

export {};
