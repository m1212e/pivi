// Tier 1 of the app protocol: plain data an app hands to the home dashboard,
// which the shell renders with its own components. Apps only supply data, so
// every app's cards look and behave like the rest of the home screen.
import { z } from 'zod';
import { appThemeSchema } from './theme';

/**
 * What activating a card, button or container does. Shared by dashboard cards
 * and Tier 2 screens (ui.ts) so both resolve through appActionHref.
 * `openOnPhone` is the host's whole answer to "do this on another device" (a
 * sign-in, say), so the host never needs a sign-in concept of its own.
 */
export const appActionSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('screen'), screenId: z.string() }),
	// `context` is opaque to the host. It is handed back to the app when the
	// player asks what to play after this one (a playlist id, say).
	z.object({ type: z.literal('session'), sessionId: z.string(), context: z.string().optional() }),
	z.object({ type: z.literal('deepLink'), target: z.string() }),
	z.object({ type: z.literal('openOnPhone'), url: z.string() })
]);

export type AppAction = z.infer<typeof appActionSchema>;

// Continue watching entry, with progress.
const resumeCardSchema = z.object({
	kind: z.literal('resume'),
	id: z.string(),
	title: z.string(),
	subtitle: z.string(),
	image: z.string(),
	progress: z.number().min(0).max(1),
	action: appActionSchema
});

// Recommended entry, no progress.
const suggestionCardSchema = z.object({
	kind: z.literal('suggestion'),
	id: z.string(),
	title: z.string(),
	meta: z.string(),
	image: z.string(),
	action: appActionSchema
});

const homeCardSchema = z.discriminatedUnion('kind', [resumeCardSchema, suggestionCardSchema]);

/** One card an app puts on the home screen, used by app code (apps/youtube) to build its contribution. */
export type HomeCard = z.infer<typeof homeCardSchema>;

/**
 * Validates `plugin/publishDashboard` at the RPC boundary (runtime.ts), since
 * apps are untrusted. The host merges every app's cards into the home rails.
 */
export const dashboardContributionSchema = z.object({
	theme: appThemeSchema.optional(),
	cards: z.array(homeCardSchema)
});

export type DashboardContribution = z.infer<typeof dashboardContributionSchema>;

/**
 * The one place an app action becomes a link, used by the home screen and
 * UiNodeRenderer so cards and screen buttons navigate the same way. Every
 * `session` goes to the shared player route, whatever app it came from.
 */
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
