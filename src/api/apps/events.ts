// Keys on the app pubsub (pubsub.ts) that aren't tied to one app.
import { appPubSub } from './pubsub';

// Published whenever any app's dashboard changes — the home page shows every
// app's dashboard at once, so it listens to one key instead of one per app.
export const ANY_DASHBOARD_EVENT = 'apps:dashboard';
// Published when the installed set changes (install, uninstall, enable/disable,
// an update applied).
export const APP_LIST_EVENT = 'apps:list';

// Published whenever what the management screens show changes — an install in
// progress, an error, a preview, any change to the installed set.
export const APP_MANAGEMENT_EVENT = 'apps:management';

// Tells every listener the installed set changed. Dashboards are told too: a
// newly installed or re-enabled app has nothing published yet and only starts
// (and contributes its cards) when the dashboards are asked for again, and one
// that was removed or restarted needs its cards dropped or re-fetched.
export function announceAppListChanged(): void {
	appPubSub.publish(APP_LIST_EVENT);
	appPubSub.publish(ANY_DASHBOARD_EVENT);
}
