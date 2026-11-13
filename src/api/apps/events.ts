// Keys on the app pubsub (pubsub.ts) that aren't tied to one app.
import { appPubSub } from './pubsub';

/**
 * The home screen shows every app's dashboard at once, so its subscription
 * (handlers/apps.ts) listens to this one key instead of one per app.
 */
export const ANY_DASHBOARD_EVENT = 'apps:dashboard';
/** Drives the home screen's app tiles, which change on install, removal or an update. */
export const APP_LIST_EVENT = 'apps:list';

/**
 * Keeps the app management screens live (handlers/appManagement.ts) while an
 * install, preview or error is in progress.
 */
export const APP_MANAGEMENT_EVENT = 'apps:management';

/**
 * Call after anything changes the installed set. Dashboards are told too, since
 * a new or re-enabled app only starts once they're asked for again, and a
 * removed one needs its cards dropped.
 */
export function announceAppListChanged(): void {
	appPubSub.publish(APP_LIST_EVENT);
	appPubSub.publish(ANY_DASHBOARD_EVENT);
}
