// Tier 1 of the app protocol: plain data an app hands to the home dashboard,
// which the shell renders with its own components. Apps only supply data, so
// every app's cards look and behave like the rest of the home screen.
import { z } from 'zod';

/**
 * What activating a card, button or container does. Shared by dashboard cards
 * and Tier 2 screens (ui.ts), and turned into navigation by the host alone.
 * `openOnPhone` is the host's whole answer to "do this on another device" (a
 * sign-in, say), so the host never needs a sign-in concept of its own. Its URL
 * must be https.
 */
export const appActionSchema = z.discriminatedUnion('type', [
	// Opens another screen this app published (ui.ts), by its `screenId`.
	z.object({ type: z.literal('screen'), screenId: z.string() }),
	// Plays a session in the shared player (`app/resolveStream`). `context` is
	// opaque to the host. It is handed back to the app when the player asks
	// what to play after this one (a playlist id, say).
	z.object({ type: z.literal('session'), sessionId: z.string(), context: z.string().optional() }),
	z.object({ type: z.literal('openOnPhone'), url: z.string() })
]);

export type AppAction = z.infer<typeof appActionSchema>;

// Shown when `image` fails to load, for a source whose best image may not
// exist (a high-res thumbnail only some videos have). Same URL rules as `image`.
const fallbackImageSchema = z.string().optional();

// Continue watching entry, with progress.
const resumeCardSchema = z.object({
	kind: z.literal('resume'),
	id: z.string(),
	title: z.string(),
	subtitle: z.string(),
	image: z.string(),
	fallbackImage: fallbackImageSchema,
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
	fallbackImage: fallbackImageSchema,
	action: appActionSchema
});

const homeCardSchema = z.discriminatedUnion('kind', [resumeCardSchema, suggestionCardSchema]);

/** One card an app puts on the home screen. */
export type HomeCard = z.infer<typeof homeCardSchema>;

/**
 * Validates `app/publishDashboard` at the RPC boundary, since apps are
 * untrusted. The host merges every app's cards into the home rails.
 */
export const dashboardContributionSchema = z.object({
	cards: z.array(homeCardSchema)
});

export type DashboardContribution = z.infer<typeof dashboardContributionSchema>;
