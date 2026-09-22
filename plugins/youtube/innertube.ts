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

// UniversalCache(false) alone is not actually non-persistent: it still
// writes to a real file on disk (os.tmpdir()/youtubei.js instead of a
// repo-local dir), just not our OAuth tokens -- those are handled
// explicitly below through our own credential storage, since that's the
// contract every plugin uses. What it does write there without
// enable_session_cache: false is an unscoped, shared-across-all-profiles
// session blob (visitor id, client config), keyed by a fixed string with
// no per-user isolation at all. enable_session_cache: false stops that
// write; the cache instance itself stays, since Player still needs it for
// signature data (getStreamingData/download, which this plugin doesn't
// use directly -- playback goes through yt-dlp, see stream.ts).
//
// This session is used for sign-in/account identity and the real
// personalized home feed and search (tvHomeFeed.ts/tvSearch.ts, via the TV
// client — the only one OAuth2 is documented to work with). The WEB client
// 400s on OAuth-only auth (no cookie), and youtubei.js's typed WEB-oriented
// parser classes (HomeFeed/Search) can't read TV/ANDROID-shaped responses
// anyway, which is why tvHomeFeed.ts/tvSearch.ts walk the raw TV response
// themselves instead of using them. See SKETCH.md's YouTube plugin notes
// for the full investigation.
//
// A `let`, not a `const`: this plugin process is shared across every pivi
// profile (one process, not one per account), so whichever profile is
// actually active can change while the process keeps running (see
// loadSessionForActiveProfile below). Every module that imports `innertube`
// sees the live binding, so a swap here is picked up everywhere without
// those modules needing to do anything differently.
export let innertube = await Innertube.create({
	cache: new UniversalCache(false),
	enable_session_cache: false
});

// Confirmed by reading OAuth2.ts directly: the *first* successful device-code
// login only ever emits 'auth', never 'update-credentials' — that event is
// exclusively for later background token refreshes. Listening only for
// 'update-credentials' (as this used to) meant nothing was ever persisted on
// the initial sign-in at all, only on a refresh that would never happen
// without a stored credential to refresh in the first place.
function persist({ credentials }: { credentials: OAuth2Tokens }) {
	storeTokens(credentials).catch(() => {});
}
function wirePersistence(client: Innertube) {
	client.session.on('auth', persist);
	client.session.on('update-credentials', persist);
}
wirePersistence(innertube);

// NOT run at module load: the host's credentialGetRequest handler only
// knows which plugin is asking once it's received this plugin's
// readyNotification (see runtime.ts — it keys credential storage off a
// `manifest` variable that notification sets). This module's top-level code
// runs before main.ts gets a chance to send that notification (ES module
// evaluation order — main.ts can't run its own body until everything it
// imports, including this file's top-level code, has finished), so calling
// getStoredTokens() here unconditionally always got `{ value: null }` back,
// even with a real stored credential — meaning sign-in silently never
// survived a process restart. main.ts calls this explicitly, after ready,
// and again every time the host says the active profile changed.
//
// Re-invokable (unlike a single memoized promise, which is all this needed
// back when it only ever ran once at startup): the host already resolves
// getStoredTokens()/credentialGetRequest against whichever profile is
// active *right now*, so calling this again after a profile switch loads
// the new profile's own credential. A fresh Innertube instance rather than
// reusing/resetting the old one, because Session's own signOut() revokes
// the credentials at Google — fine for a real "sign out of YouTube" action,
// wrong here, since switching pivi profiles must never invalidate the
// *previous* profile's real Google login.
export async function loadSessionForActiveProfile(): Promise<void> {
	const stored = await getStoredTokens();

	const next = await Innertube.create({
		cache: new UniversalCache(false),
		enable_session_cache: false
	});
	wirePersistence(next);
	if (stored) {
		try {
			await next.session.signIn(stored);
		} catch (err) {
			// Stored tokens no longer valid (revoked, expired refresh token) —
			// fall back to signed-out browsing; the user can sign in again.
			console.error('[youtube] stored sign-in failed:', err);
		}
	}

	innertube = next;
}
