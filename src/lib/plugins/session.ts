// Exclusive sessions: a plugin that needs direct hardware access instead
// of shell-mediated rendering/input — playback (libmpv), game streaming
// (Moonlight/Sunshine), the Cast receiver's handoff. Granted only while
// the session is active; the shell reclaims the display/input the moment
// it ends. See SKETCH.md's "Exclusive/passthrough sessions" decision.
import { z } from 'zod';

// Must be a subset of what the plugin's manifest actually declared — the
// host refuses to start a session asking for more than was granted at
// install time.
export const sessionRequestSchema = z.object({
	pluginId: z.string(),
	sessionId: z.string(),
	needs: z.array(z.enum(['display-exclusive', 'input-gamepad'])),
	// Present for a playback session (the first real consumer, the YouTube
	// plugin): the resolved, directly playable stream URL. `audioUrl` is
	// separate rather than assumed-muxed-into `url` — most modern YouTube
	// formats are video-only + audio-only rather than one combined file, so
	// the player needs to open both. A future session kind that isn't "play
	// this URL" (game streaming, say) would need its own optional field
	// alongside this one rather than overloading it.
	media: z
		.object({ url: z.string(), audioUrl: z.string().optional(), title: z.string().optional() })
		.optional()
});

export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export const sessionEndedSchema = z.object({
	sessionId: z.string(),
	reason: z.enum(['completed', 'userExited', 'error']),
	message: z.string().optional()
});

export type SessionEnded = z.infer<typeof sessionEndedSchema>;

// Tier 3 fallback: a sandboxed webview for services with no API and no
// workable Tier 2 mapping. Deliberately second-class — no shared
// theme/focus-nav integration beyond what the iframe boundary allows.
export const webviewScreenSchema = z.object({
	pluginId: z.string(),
	screenId: z.string(),
	url: z.string(),
	// Touch/trackpad emulation from the paired phone remote substitutes for
	// real spatial navigation here, since the content inside wasn't built
	// for it.
	inputMode: z.literal('touch-emulated')
});

export type WebviewScreen = z.infer<typeof webviewScreenSchema>;
