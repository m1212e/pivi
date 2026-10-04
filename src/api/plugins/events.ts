// Keys on the plugin pubsub (pubsub.ts) that aren't tied to one plugin.
import { pluginPubSub } from './pubsub';

// Published whenever any plugin's dashboard changes — the home page shows every
// plugin's dashboard at once, so it listens to one key instead of one per plugin.
export const ANY_DASHBOARD_EVENT = 'plugins:dashboard';
// Published when the installed set changes (install, uninstall, enable/disable,
// an update applied).
export const PLUGIN_LIST_EVENT = 'plugins:list';

// Published whenever what the management screens show changes — an install in
// progress, an error, a preview, any change to the installed set.
export const PLUGIN_MANAGEMENT_EVENT = 'plugins:management';

// Tells every listener the installed set changed. Dashboards are told too: a
// newly installed or re-enabled plugin has nothing published yet and only starts
// (and contributes its cards) when the dashboards are asked for again, and one
// that was removed or restarted needs its cards dropped or re-fetched.
export function announcePluginListChanged(): void {
	pluginPubSub.publish(PLUGIN_LIST_EVENT);
	pluginPubSub.publish(ANY_DASHBOARD_EVENT);
}
