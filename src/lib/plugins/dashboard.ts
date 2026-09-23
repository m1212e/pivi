// Tier 1: typed data a plugin hands to the shared home-dashboard
// components (ContinueWatchingRow/PosterRow/AppsRow — see
// src/lib/components). The plugin never renders these itself, only
// supplies data — in the same shape the dashboard's placeholder data in
// src/routes/home/+page.svelte already mirrors, deliberately, so wiring in
// a real plugin later only swaps the data source, not the layout.
import { z } from 'zod';
import { pluginThemeSchema } from './theme';

// What happens when a card (or an AppsRow entry) is activated. `screen`
// opens a Tier 2 declarative screen, `session` starts an exclusive
// display/input handoff (see session.ts), `deepLink` is a plugin-defined
// string it interprets itself (e.g. "resume:episode-42").
export const pluginActionSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('screen'), screenId: z.string() }),
	z.object({ type: z.literal('session'), sessionId: z.string() }),
	z.object({ type: z.literal('deepLink'), target: z.string() })
]);

export type PluginAction = z.infer<typeof pluginActionSchema>;

const resumeCardSchema = z.object({
	kind: z.literal('resume'),
	id: z.string(),
	title: z.string(),
	subtitle: z.string(),
	image: z.string(),
	progress: z.number().min(0).max(1),
	action: pluginActionSchema
});

const suggestionCardSchema = z.object({
	kind: z.literal('suggestion'),
	id: z.string(),
	title: z.string(),
	meta: z.string(),
	image: z.string(),
	action: pluginActionSchema
});

const homeCardSchema = z.discriminatedUnion('kind', [resumeCardSchema, suggestionCardSchema]);

export type HomeCard = z.infer<typeof homeCardSchema>;

// Sent by a plugin whenever its cards change; the host merges contributions
// from every plugin into one set of home-dashboard rails, sorted by
// recency for resume cards.
export const dashboardContributionSchema = z.object({
	pluginId: z.string(),
	theme: pluginThemeSchema.optional(),
	cards: z.array(homeCardSchema)
});

export type DashboardContribution = z.infer<typeof dashboardContributionSchema>;

// Turns a card's (or a screen button's) action into a URL, generic over
// whichever plugin it came from. A `session` action always resolves to the
// one shared player route (src/routes/play) regardless of plugin — that
// route asks the plugin itself to resolve the stream, so nothing here needs
// to know how any particular plugin plays media. A `deepLink` still goes
// through the app's own query-param convention (the app's +page.svelte reads
// it back out and forwards it to the plugin as a UI event), since that
// convention is plugin-defined and has nothing to do with playback.
export function pluginActionHref(pluginId: string, appHref: string, action: PluginAction): string {
	if (action.type === 'session') {
		return `/play/${encodeURIComponent(pluginId)}/${encodeURIComponent(action.sessionId)}`;
	}
	if (action.type === 'deepLink') {
		return `${appHref}?deepLink=${encodeURIComponent(action.target)}`;
	}
	return appHref;
}
