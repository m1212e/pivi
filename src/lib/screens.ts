// Screens the app navigates between. Each one zooms the same way to and from
// any other, `null` (e.g. /remote) has no zoom identity.
export type ScreenKind = 'login' | 'home' | 'app' | 'player';

// A lookup table instead of an if-chain keeps every predicate trivial.
const SCREEN_MATCHERS: [ScreenKind, (path: string) => boolean][] = [
	['home', (path) => path === '/home'],
	['app', (path) => path.startsWith('/apps/')],
	['player', (path) => path.startsWith('/play/')],
	['login', (path) => path === '/' || path.startsWith('/login') || path.startsWith('/register')]
];

// Only used to pick a zoom direction. The player can open from home or from
// an app's own screen, so it sits deepest.
const SCREEN_DEPTH: Record<ScreenKind, number> = { login: 0, home: 1, app: 2, player: 3 };

export function screenKindOf(path: string): ScreenKind | null {
	return SCREEN_MATCHERS.find(([, matches]) => matches(path))?.[0] ?? null;
}

export type ZoomKind = 'zoom-in' | 'zoom-out';

// NaN for a path with no zoom identity, so any comparison against it fails.
function depthOf(path: string): number {
	const kind = screenKindOf(path);
	return kind ? SCREEN_DEPTH[kind] : NaN;
}

/** Direction of the zoom between two paths, or null when there is none. */
export function zoomKindBetween(from: string, to: string): ZoomKind | null {
	const delta = depthOf(to) - depthOf(from);
	if (!delta) return null;
	return delta > 0 ? 'zoom-in' : 'zoom-out';
}

/** Only logging in gets the jingle, not returning home from an app. */
export function isLoginToHome(from: string, to: string): boolean {
	return to === '/home' && screenKindOf(from) === 'login';
}

type NavigationEnds = { from: { url: URL } | null; to: { url: URL } | null };

/** Both pathnames of a navigation, or null when either end is missing. */
export function navigationPaths(navigation: NavigationEnds): { from: string; to: string } | null {
	if (!navigation.from || !navigation.to) return null;
	return { from: navigation.from.url.pathname, to: navigation.to.url.pathname };
}

const LOGIN_PATH = /^\/login\/([^/]+)$/;

/** The profile id named by whichever side is a login path, `to` first. */
export function loginProfileId(from: string, to: string): string | undefined {
	return to.match(LOGIN_PATH)?.[1] ?? from.match(LOGIN_PATH)?.[1];
}
