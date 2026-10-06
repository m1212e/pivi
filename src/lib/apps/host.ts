// The single definition of the host/app JSON-RPC protocol, shared by the host
// runtime and the TypeScript app SDK so neither side can drift. Apps in other
// languages get the same methods as JSON Schema (protocolSchema.ts).
import { NotificationType, NotificationType0, RequestType } from 'vscode-jsonrpc';
import { z } from 'zod';
import { dashboardContributionSchema } from './dashboard';
import { appScreenSchema, uiEventSchema } from './ui';

// App -> host

/** Sent by apps in `plugin/ready` and declared in their manifest. */
export const PROTOCOL_VERSION = 1;
/** Checked by the registry at install and the runtime at start, so an incompatible app is refused instead of failing oddly. */
export const SUPPORTED_PROTOCOLS: readonly number[] = [PROTOCOL_VERSION];

/**
 * The app's first message, telling the host it can take requests. Only the
 * protocol version, since what the app may do comes from its approved
 * manifest, never from the running app.
 */
export const readyParamsSchema = z.object({ protocol: z.number().int().positive() });
export const readyNotification = new NotificationType<z.infer<typeof readyParamsSchema>>(
	'plugin/ready'
);

/** How an app fills its part of the home dashboard. Replaces its previous cards. */
export const publishDashboardNotification = new NotificationType<
	z.infer<typeof dashboardContributionSchema>
>('plugin/publishDashboard');

/** How an app shows its own pages (ui.ts). Replaces the screen with the same id. */
export const publishScreenNotification = new NotificationType<z.infer<typeof appScreenSchema>>(
	'plugin/publishScreen'
);

// The container each track is packaged in. It has to come from whatever
// resolved the stream, since the codec alone doesn't tell (YouTube serves vp9
// as mp4 or webm).
const containerSchema = z.enum(['mp4', 'webm']);

// Rides along on ResolvedStream because yt-dlp reports caption URLs with the
// stream anyway. `url` stays server side and is only fetched through the
// stream-subtitle proxy. Only vtt, so the host never converts formats.
const subtitleTrackSchema = z.object({
	language: z.string(),
	// Falls back to `language` on the client when absent.
	label: z.string().optional(),
	// Shown in the picker so auto-generated tracks don't read as equally
	// reliable as authored ones.
	kind: z.enum(['caption', 'transcription']),
	url: z.string(),
	format: z.literal('vtt')
});
/** Used across the player's subtitle picker, the subtitle proxy and the phone remote. */
export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>;

/**
 * The generic answer to `plugin/resolveStream`, so the shared player and the
 * stream proxy never need to know an app's source. Audio is separate because
 * most sources serve video-only plus audio-only, which the proxy remuxes, and
 * `duration` comes from here because a live remux can't report its own.
 */
export const resolvedStreamSchema = z.object({
	videoUrl: z.string(),
	audioUrl: z.string().optional(),
	vcodec: z.string(),
	acodec: z.string().optional(),
	videoContainer: containerSchema,
	audioContainer: containerSchema.optional(),
	title: z.string(),
	duration: z.number(),
	// Absent (not just empty) for an app that has no subtitle source at
	// all. Same "optional, treated as none" convention resolveSkipSegments
	// uses for an app with no handler registered.
	subtitleTracks: z.array(subtitleTrackSchema).optional()
});
export type ResolvedStream = z.infer<typeof resolvedStreamSchema>;

// `maxHeight` lets the viewer cap quality in the player, since always asking
// for the best stream made real-time remuxing choppy in practice.
export const resolveStreamParamsSchema = z.object({
	sessionId: z.string(),
	maxHeight: z.number().optional()
});
/** How the shared player gets something playable for a `session` action, from any app with the `playback` feature. */
export const resolveStreamRequest = new RequestType<
	z.infer<typeof resolveStreamParamsSchema>,
	ResolvedStream,
	void
>('plugin/resolveStream');

const skipSegmentSchema = z.object({
	startSeconds: z.number(),
	endSeconds: z.number(),
	label: z.string()
});
/**
 * A stretch the player skips automatically (SponsorBlock for YouTube). Kept
 * source agnostic, the player only needs a range and a label for its banner.
 */
export type SkipSegment = z.infer<typeof skipSegmentSchema>;

export const resolveSkipSegmentsParamsSchema = z.object({ sessionId: z.string() });
export const resolveSkipSegmentsResultSchema = z.object({ segments: z.array(skipSegmentSchema) });
/** Feeds the player's auto skip. Only sent to apps declaring the `skipSegments` feature. */
export const resolveSkipSegmentsRequest = new RequestType<
	z.infer<typeof resolveSkipSegmentsParamsSchema>,
	z.infer<typeof resolveSkipSegmentsResultSchema>,
	void
>('plugin/resolveSkipSegments');

// `context` is whatever the app put on the session action. No `sessionId` in
// the answer means there is nothing after this one.
export const resolveNextParamsSchema = z.object({
	sessionId: z.string(),
	context: z.string().optional()
});
export const resolveNextResultSchema = z.object({ sessionId: z.string().optional() });
/** Lets the player continue a playlist once a session ends, without knowing the app's sequencing. */
export const resolveNextRequest = new RequestType<
	z.infer<typeof resolveNextParamsSchema>,
	z.infer<typeof resolveNextResultSchema>,
	void
>('plugin/resolveNext');

// Outbound network access isn't an RPC: it's the `network` permission, enforced
// by the sandbox for exactly the manifest's declared domains (see
// src/api/apps/sandbox). Likewise persistent and disposable state are the
// `storage` and `cache` volumes mounted into the container, and logs are just
// the process's stderr.

// Host -> app

// A BCP 47 tag like `de-DE`, so an app can ask its backend for results in the
// language the person reads.
export const activateParamsSchema = z.object({ locale: z.string() });
/** Tells a ready app it may start publishing, along with the host's locale. */
export const activateNotification = new NotificationType<z.infer<typeof activateParamsSchema>>(
	'host/activate'
);

/** The only way user input on a published screen reaches the app, since it has no DOM access. */
export const uiEventNotification = new NotificationType<z.infer<typeof uiEventSchema>>(
	'host/uiEvent'
);

/** The TV's language often becomes known only after the app started, once a page is opened. */
export const localeNotification = new NotificationType<z.infer<typeof activateParamsSchema>>(
	'host/locale'
);

/** Gives the app a chance to exit cleanly before the host kills it. */
export const shutdownNotification = new NotificationType0('host/shutdown');
