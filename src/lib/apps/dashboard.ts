// Tier 1: typed data an app hands to the shared home-dashboard
// components (ContinueWatchingRow/PosterRow/AppsRow — see
// src/lib/components). The app never renders these itself, only
// supplies data — in the same shape the dashboard's placeholder data in
// src/routes/home/+page.svelte already mirrors, deliberately, so wiring in
// a real app later only swaps the data source, not the layout.
import { z } from 'zod';
import { appThemeSchema } from './theme';

// What happens when a card (or an AppsRow entry) is activated. `screen`
// opens a Tier 2 declarative screen, `session` starts an exclusive
// display/input handoff (see session.ts), `deepLink` is an app-defined
// string it interprets itself (e.g. "resume:episode-42"), `openOnPhone`
// pushes a URL to the paired phone instead of navigating the TV anywhere —
// the host's whole answer to "this app needs the user to do something on
// another device" (a sign-in, say): an app builds whatever screen content it
// needs (a code, instructions) out of plain UiNodes and wires this action to
// the one button that actually needs the phone, rather than the host
// understanding "sign-in" as its own concept.
export const appActionSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('screen'), screenId: z.string() }),
	// `context` is opaque to the host. It is handed back to the app when the
	// player asks what to play after this one (a playlist id, say).
	z.object({ type: z.literal('session'), sessionId: z.string(), context: z.string().optional() }),
	z.object({ type: z.literal('deepLink'), target: z.string() }),
	z.object({ type: z.literal('openOnPhone'), url: z.string() })
]);

export type AppAction = z.infer<typeof appActionSchema>;

const resumeCardSchema = z.object({
	kind: z.literal('resume'),
	id: z.string(),
	title: z.string(),
	subtitle: z.string(),
	image: z.string(),
	progress: z.number().min(0).max(1),
	action: appActionSchema
});

const suggestionCardSchema = z.object({
	kind: z.literal('suggestion'),
	id: z.string(),
	title: z.string(),
	meta: z.string(),
	image: z.string(),
	action: appActionSchema
});

const homeCardSchema = z.discriminatedUnion('kind', [resumeCardSchema, suggestionCardSchema]);

export type HomeCard = z.infer<typeof homeCardSchema>;

// Sent by an app whenever its cards change; the host merges contributions
// from every app into one set of home-dashboard rails, sorted by
// recency for resume cards.
export const dashboardContributionSchema = z.object({
	theme: appThemeSchema.optional(),
	cards: z.array(homeCardSchema)
});

export type DashboardContribution = z.infer<typeof dashboardContributionSchema>;

// Turns a card's (or a screen button's) action into a URL, generic over
// whichever app it came from. A `session` action always resolves to the
// one shared player route (src/routes/play) regardless of app — that
// route asks the app itself to resolve the stream, so nothing here needs
// to know how any particular app plays media. A `deepLink` still goes
// through the app's own query-param convention (the app's +page.svelte reads
// it back out and forwards it to the app as a UI event), since that
// convention is app-defined and has nothing to do with playback.
export function appActionHref(appId: string, appHref: string, action: AppAction): string {
	if (action.type === 'session') {
		const base = `/play/${encodeURIComponent(appId)}/${encodeURIComponent(action.sessionId)}`;
		return action.context ? `${base}?context=${encodeURIComponent(action.context)}` : base;
	}
	if (action.type === 'deepLink') {
		return `${appHref}?deepLink=${encodeURIComponent(action.target)}`;
	}
	return appHref;
}
