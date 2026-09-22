// The shared YouTube InnerTube session — used by both youtubeClient.ts
// (browsing) and auth.ts (sign-in), since sign-in state lives on the
// session itself rather than being a separate client per call.
//
// This is youtubei.js instead of the official Data API specifically so
// login never needs a Google Cloud project registered by us:
// session.signIn() scrapes the client id YouTube's own TV web app already
// uses (from youtube.com/tv) and runs the real device-code OAuth grant
// against that — see OAuth2.ts in the library for exactly what it does.
// That's an unofficial, reverse-engineered path (the same one NewPipe/
// Piped/Invidious/yt-dlp already rely on for various things), not an
// official integration.
import { Innertube, UniversalCache } from 'youtubei.js';
import type { OAuth2Tokens } from 'youtubei.js';
import {
	credentialGetRequest,
	credentialGetResultSchema,
	credentialSetParamsSchema,
	credentialSetRequest
} from '#lib/plugins/host';
import { connection } from './connection';

async function getStoredTokens(): Promise<OAuth2Tokens | null> {
	const result = credentialGetResultSchema.parse(
		await connection.sendRequest(credentialGetRequest)
	);
	return result.value ? (JSON.parse(result.value) as OAuth2Tokens) : null;
}

async function storeTokens(tokens: OAuth2Tokens): Promise<void> {
	await connection.sendRequest(
		credentialSetRequest,
		credentialSetParamsSchema.parse({ value: JSON.stringify(tokens) })
	);
}

// Non-persistent: the library's own cache is for player/signature data
// (needed for getStreamingData/download, which this plugin doesn't use —
// playback still goes through yt-dlp, see stream.ts), not for our OAuth
// tokens. Those are handled explicitly below through our own credential
// storage instead, since that's the contract every plugin uses.
//
// This session is used for sign-in/account identity and, once signed in,
// the real personalized home feed (tvHomeFeed.ts, via the TV client — the
// only one OAuth2 is documented to work with). Generic/signed-out browsing
// goes through invidious.ts instead: the WEB client here 400s on OAuth-only
// auth (no cookie), and youtubei.js's typed WEB-oriented parser classes
// (HomeFeed/Search) can't read TV/ANDROID-shaped responses, which is why
// tvHomeFeed.ts walks the raw TV response itself instead of using them. See
// SKETCH.md's YouTube plugin notes for the full investigation.
export const innertube = await Innertube.create({ cache: new UniversalCache(false) });

// Confirmed by reading OAuth2.ts directly: the *first* successful device-code
// login only ever emits 'auth', never 'update-credentials' — that event is
// exclusively for later background token refreshes. Listening only for
// 'update-credentials' (as this used to) meant nothing was ever persisted on
// the initial sign-in at all, only on a refresh that would never happen
// without a stored credential to refresh in the first place.
function persist({ credentials }: { credentials: OAuth2Tokens }) {
	storeTokens(credentials).catch(() => {});
}
innertube.session.on('auth', persist);
innertube.session.on('update-credentials', persist);

// NOT run at module load: the host's credentialGetRequest handler only
// knows which plugin is asking once it's received this plugin's
// readyNotification (see runtime.ts — it keys credential storage off a
// `manifest` variable that notification sets). This module's top-level code
// runs before main.ts gets a chance to send that notification (ES module
// evaluation order — main.ts can't run its own body until everything it
// imports, including this file's top-level code, has finished), so calling
// getStoredTokens() here unconditionally always got `{ value: null }` back,
// even with a real stored credential — meaning sign-in silently never
// survived a process restart. main.ts calls this explicitly, after ready.
let restored: Promise<void> | undefined;
export function restoreSession(): Promise<void> {
	if (!restored) {
		restored = (async () => {
			const stored = await getStoredTokens();
			if (!stored) return;
			try {
				await innertube.session.signIn(stored);
			} catch (err) {
				// Stored tokens no longer valid (revoked, expired refresh token) —
				// fall back to signed-out browsing; the user can sign in again.
				console.error('[youtube] stored sign-in failed:', err);
			}
		})();
	}
	return restored;
}
