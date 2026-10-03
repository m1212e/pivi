// Keys on the plugin pubsub (pubsub.ts) that aren't tied to one plugin.
// Published whenever any plugin's dashboard changes — the home page shows every
// plugin's dashboard at once, so it listens to one key instead of one per plugin.
export const ANY_DASHBOARD_EVENT = 'plugins:dashboard';
// Published when the installed set changes (install, uninstall, enable/disable,
// an update applied).
export const PLUGIN_LIST_EVENT = 'plugins:list';
