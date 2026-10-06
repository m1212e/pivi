// Where the phone's Back and Home buttons are worth showing at all. Neither
// the pre-login profile picker nor the home screen has anywhere sensible to go
// back to, and Home only goes somewhere new from inside an app or the player
// (mirroring hooks.server.ts's own definition of "has an active profile").
const NO_BACK = new Set(['/', '/home']);
const HOME_EXACT = new Set(['/apps', '/wifi']);
const HOME_PREFIXES = ['/apps/', '/play/'];

export function navigationFlagsFor(pathname: string) {
	return {
		canGoBack: !NO_BACK.has(pathname),
		canGoHome:
			HOME_EXACT.has(pathname) || HOME_PREFIXES.some((prefix) => pathname.startsWith(prefix))
	};
}
