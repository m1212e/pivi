// The single definition of the host/app JSON-RPC protocol, shared by the host
// runtime and the TypeScript app SDK so neither side can drift. Apps in other
// languages get the same methods as JSON Schema (protocolSchema.ts).
//
// Everything in sdk/ is the contract between pivi and its apps, and nothing
// else: it imports only zod, vscode-jsonrpc and itself, never host code, so an
// app can be built from this directory alone (see apps/youtube/Dockerfile).
import { NotificationType, NotificationType0, RequestType, RequestType0 } from 'vscode-jsonrpc';
import { z } from 'zod';
import { dashboardContributionSchema } from './dashboard';
import { idSchema, MAX_LIST_ITEMS, textSchema, tokenSchema, urlSchema } from './limits';
import { appScreenSchema, uiEventSchema } from './ui';

// App -> host

/** Sent by apps in `app/ready` and declared in their manifest. */
export const PROTOCOL_VERSION = 2;
/** Checked by the registry at install and the runtime at start, so an incompatible app is refused instead of failing oddly. */
export const SUPPORTED_PROTOCOLS: readonly number[] = [PROTOCOL_VERSION];

/**
 * The app's first message, telling the host it can take requests. Only the
 * protocol version, since what the app may do comes from its approved
 * manifest, never from the running app.
 */
export const readyParamsSchema = z.object({ protocol: z.number().int().positive() });
export const readyNotification = new NotificationType<z.infer<typeof readyParamsSchema>>(
	'app/ready'
);

/** How an app fills its part of the home dashboard. Replaces its previous cards. */
export const publishDashboardNotification = new NotificationType<
	z.infer<typeof dashboardContributionSchema>
>('app/publishDashboard');

/** How an app shows its own pages (ui.ts). Replaces the screen with the same id. */
export const publishScreenNotification = new NotificationType<z.infer<typeof appScreenSchema>>(
	'app/publishScreen'
);

// The container each track is packaged in. It has to come from whatever
// resolved the stream, since the codec alone doesn't tell (vp9 comes as both
// mp4 and webm).
const containerSchema = z.enum(['mp4', 'webm']);

// Rides along on ResolvedStream since extractors usually report caption URLs
// with the stream. `url` stays server side and is only fetched through the
// host's subtitle proxy. Only vtt, so the host never converts formats.
const subtitleTrackSchema = z.object({
	language: tokenSchema,
	// Falls back to `language` on the client when absent.
	label: textSchema.optional(),
	// Shown in the picker so auto-generated tracks don't read as equally
	// reliable as authored ones.
	kind: z.enum(['caption', 'transcription']),
	url: urlSchema,
	format: z.literal('vtt')
});
/** Used across the player's subtitle picker, the subtitle proxy and the phone remote. */
export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>;

/**
 * The generic answer to `app/resolveStream`, so the shared player and the
 * stream proxy never need to know an app's source. Audio is separate because
 * most sources serve video-only plus audio-only, which the proxy remuxes, and
 * `duration` comes from here because a live remux can't report its own.
 *
 * Separate tracks are played through MSE, which needs each file's segment
 * index: an mp4 must carry a `sidx` box and a webm a `Cues` element within its
 * first 2 MiB, as DASH-ready adaptive files do. A single `videoUrl` without
 * `audioUrl` is played as is and has no such requirement.
 */
export const resolvedStreamSchema = z.object({
	videoUrl: urlSchema,
	audioUrl: urlSchema.optional(),
	vcodec: tokenSchema,
	acodec: tokenSchema.optional(),
	videoContainer: containerSchema,
	audioContainer: containerSchema.optional(),
	title: textSchema,
	duration: z.number(),
	// Video heights the app can serve through `maxHeight`, so the player offers
	// exactly these. Absent or empty for an app without a quality choice, then
	// the player shows no picker and never sends a cap.
	qualities: z.array(z.number().int().positive()).max(MAX_LIST_ITEMS).optional(),
	// Absent (not just empty) for an app that has no subtitle source at
	// all. Same "optional, treated as none" convention resolveSkipSegments
	// uses for an app with no handler registered.
	subtitleTracks: z.array(subtitleTrackSchema).max(MAX_LIST_ITEMS).optional()
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
>('app/resolveStream');

const skipSegmentSchema = z.object({
	startSeconds: z.number(),
	endSeconds: z.number(),
	label: textSchema
});
/**
 * A stretch the player skips automatically (a sponsor segment, an intro).
 * Kept source agnostic, the player only needs a range and a label for its banner.
 */
export type SkipSegment = z.infer<typeof skipSegmentSchema>;

export const resolveSkipSegmentsParamsSchema = z.object({ sessionId: z.string() });
export const resolveSkipSegmentsResultSchema = z.object({
	segments: z.array(skipSegmentSchema).max(MAX_LIST_ITEMS)
});
/** Feeds the player's auto skip. Only sent to apps declaring the `skipSegments` feature. */
export const resolveSkipSegmentsRequest = new RequestType<
	z.infer<typeof resolveSkipSegmentsParamsSchema>,
	z.infer<typeof resolveSkipSegmentsResultSchema>,
	void
>('app/resolveSkipSegments');

// `context` is whatever the app put on the session action. No `sessionId` in
// the answer means there is nothing after this one.
export const resolveNextParamsSchema = z.object({
	sessionId: z.string(),
	context: z.string().optional()
});
export const resolveNextResultSchema = z.object({ sessionId: idSchema.optional() });
/** Lets the player continue a playlist once a session ends, without knowing the app's sequencing. */
export const resolveNextRequest = new RequestType<
	z.infer<typeof resolveNextParamsSchema>,
	z.infer<typeof resolveNextResultSchema>,
	void
>('app/resolveNext');

// Outbound network access isn't an RPC: it's the `network` permission, enforced
// by the sandbox for exactly the manifest's declared domains. Likewise persistent and disposable state are the
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

/**
 * Sent when the home screen is opened, so the cards there aren't whatever the
 * app published at boot. Answered with a new `app/publishDashboard`. Only sent
 * to apps declaring the `dashboard` feature, at most twice a minute.
 */
export const refreshDashboardNotification = new NotificationType0('host/refreshDashboard');

/** Gives the app a chance to exit cleanly before the host kills it. */
export const shutdownNotification = new NotificationType0('host/shutdown');

/**
 * Sent when a request to the app timed out, to tell a slow app from a hung
 * one. Any answer counts, even an error for an unknown method, so an app only
 * has to keep its message loop running. One that doesn't answer is killed.
 */
export const pingRequest = new RequestType0<null, void>('host/ping');
