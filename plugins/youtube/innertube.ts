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
import { readFile, writeFile } from 'node:fs/promises';

// The signed-in session's tokens, in this plugin's own persistent volume (the
// `storage` permission mounts it at /storage, one per profile — so each pivi
// profile keeps its own YouTube login). Without the permission there's simply
// no volume: browsing signed out still works, a login just doesn't survive a
// restart.
const TOKEN_FILE = '/storage/oauth-tokens.json';

async function getStoredTokens(): Promise<OAuth2Tokens | null> {
	try {
		return JSON.parse(await readFile(TOKEN_FILE, 'utf8')) as OAuth2Tokens;
	} catch {
		return null;
	}
}

async function storeTokens(tokens: OAuth2Tokens): Promise<void> {
	try {
		await writeFile(TOKEN_FILE, JSON.stringify(tokens), { mode: 0o600 });
	} catch (err) {
		console.error('[youtube] could not persist the sign-in (is storage allowed?):', String(err));
	}
}

// Nothing here writes a cache of its own: UniversalCache(false) is in-memory, and
// enable_session_cache: false stops youtubei.js persisting its session blob
// (visitor id, client config) anywhere shared. The only thing kept across runs
// is the login, in /storage above.
//
// This session is used for sign-in/account identity and the real
// personalized home feed (tvHomeFeed.ts, via the TV client — the only one
// OAuth2 is documented to work with). The WEB client 400s on OAuth-only auth
// (no cookie), and youtubei.js's typed WEB-oriented parser classes (HomeFeed)
// can't read TV/ANDROID-shaped responses anyway, which is why tvHomeFeed.ts
// walks the raw TV response itself instead of using them.
//
// A `let` so the session can be swapped once the stored login has been loaded
// (loadStoredSession below); every module importing `innertube` sees the live
// binding.
export let innertube = await Innertube.create({
	cache: new UniversalCache(false),
	enable_session_cache: false
});

// The *first* successful device-code login only ever emits 'auth', never
// 'update-credentials' — that event is exclusively for later background token
// refreshes. Both have to be persisted, or a fresh sign-in is lost on restart.
function persist({ credentials }: { credentials: OAuth2Tokens }) {
	storeTokens(credentials).catch(() => {});
}
function wirePersistence(client: Innertube) {
	client.session.on('auth', persist);
	client.session.on('update-credentials', persist);
}
wirePersistence(innertube);

// Not run at module load but from main.ts once the host has activated the
// plugin. The host runs this plugin once per active pivi profile (it's stopped
// and started again on a profile switch), with that profile's own /storage
// mounted — so there's exactly one login to look for here, and no cross-profile
// state to reset. A fresh Innertube rather than reusing the old one: a Session's
// own signOut() revokes the credentials at Google, which nothing here should do.
export async function loadStoredSession(): Promise<void> {
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
