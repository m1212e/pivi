// Where an app action leads, on the host's side of the contract: apps name
// what should happen (#sdk/dashboard's AppAction), the host decides the route.
import type { AppAction } from '#sdk/dashboard';
import { playHref, appScreenHref } from '../routes';

/**
 * The one place an app action becomes a link, used by the home screen and
 * UiNodeRenderer so cards and screen buttons navigate the same way. Every
 * `session` goes to the shared player route, whatever app it came from.
 * `openOnPhone` has no link, its buttons send it to the phone instead.
 */
export function appActionHref(appId: string, action: AppAction): string | undefined {
	switch (action.type) {
		case 'session':
			return playHref(appId, action.sessionId, action.context);
		case 'screen':
			return appScreenHref(appId, action.screenId);
		case 'openOnPhone':
			return undefined;
	}
}
