// Every in-app path in one place. Pages, guards and link builders import from
// here, so a moved route is a one-line change and typos can't create dead links.

export const ROUTES = {
	login: '/',
	home: '/home',
	apps: '/apps',
	wifi: '/wifi',
	register: '/register'
} as const;

export const APPS_PREFIX = '/apps/';
export const PLAY_PREFIX = '/play/';
export const LOGIN_PREFIX = '/login';
export const API_PREFIX = '/api/';
export const REMOTE_PREFIX = '/remote';

export function appHref(appId: string): string {
	return `${APPS_PREFIX}${encodeURIComponent(appId)}`;
}

/** An app's page on one of the screens it published, or on its entry screen. */
export function appScreenHref(appId: string, screenId?: string): string {
	const base = appHref(appId);
	return screenId ? `${base}?${new URLSearchParams({ screen: screenId })}` : base;
}

export function loginHref(profileId: string): string {
	return `${LOGIN_PREFIX}/${profileId}`;
}

/** The shared player route, whichever app the session belongs to. */
export function playHref(appId: string, sessionId: string, context?: string): string {
	const base = `${PLAY_PREFIX}${encodeURIComponent(appId)}/${encodeURIComponent(sessionId)}`;
	return context ? `${base}?${new URLSearchParams({ context })}` : base;
}

export function isPlayPath(pathname: string): boolean {
	return pathname.startsWith(PLAY_PREFIX);
}
