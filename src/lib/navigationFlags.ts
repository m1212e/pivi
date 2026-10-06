// Where the phone's Back and Home buttons are worth showing at all. Neither
// the pre-login profile picker nor the home screen has anywhere sensible to go
// back to, and Home only goes somewhere new from inside an app or the player
// (mirroring hooks.server.ts's own definition of "has an active profile").
import { APPS_PREFIX, PLAY_PREFIX, ROUTES } from './routes';

const NO_BACK = new Set<string>([ROUTES.login, ROUTES.home]);
const HOME_EXACT = new Set<string>([ROUTES.apps, ROUTES.wifi]);
const HOME_PREFIXES = [APPS_PREFIX, PLAY_PREFIX];

/**
 * RemoteBridge sends these to the paired phone so it can hide Back and Home
 * where they would do nothing.
 */
export function navigationFlagsFor(pathname: string) {
	return {
		canGoBack: !NO_BACK.has(pathname),
		canGoHome:
			HOME_EXACT.has(pathname) || HOME_PREFIXES.some((prefix) => pathname.startsWith(prefix))
	};
}
