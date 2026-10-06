// The app<->host RPC boundary (see SKETCH.md's "App sandboxing"
// decision). An app is an OCI image whose entrypoint speaks JSON-RPC 2.0 over
// its stdin/stdout, one JSON message per line (see ndjson.ts), with logs on
// stderr — so it can be written in any language, and nothing in this file
// assumes one. vscode-jsonrpc is only the host's (and the TypeScript SDK's)
// way of speaking it: request/response correlation is handled by the library
// instead of by hand. The same method names and schemas are published as JSON
// Schema (protocolSchema.ts, docs/app-protocol.schema.json) for every other
// language.
import { NotificationType, NotificationType0, RequestType } from 'vscode-jsonrpc';
import { z } from 'zod';
import { dashboardContributionSchema } from './dashboard';
import { appScreenSchema, uiEventSchema } from './ui';

// App -> host

// The version of this protocol; an app's manifest names the one it speaks
// (`protocol`), and the host refuses to run one it doesn't support.
export const PROTOCOL_VERSION = 1;
export const SUPPORTED_PROTOCOLS: readonly number[] = [PROTOCOL_VERSION];

// The first message an app sends, once it can receive requests. Carries
// nothing but the protocol version: what the app is and what it may do is
// its manifest, which the host already read from the image and the user
// already approved — never something a running app gets to restate.
export const readyParamsSchema = z.object({ protocol: z.number().int().positive() });
export const readyNotification = new NotificationType<z.infer<typeof readyParamsSchema>>(
	'plugin/ready'
);

export const publishDashboardNotification = new NotificationType<
	z.infer<typeof dashboardContributionSchema>
>('plugin/publishDashboard');

export const publishScreenNotification = new NotificationType<z.infer<typeof appScreenSchema>>(
	'plugin/publishScreen'
);

// Any app that wants in-browser playback implements this same handler
// shape — the host never knows anything about a particular app's stream
// source, only this generic result. `audioUrl` is separate rather than
// assumed-muxed-into `videoUrl` since most modern YouTube formats (and
// plausibly other sources) are video-only + audio-only rather than one
// combined file — the streaming proxy (src/routes/api/stream) remuxes them.
// `duration` has to come from here rather than the eventual <video> element,
// since a live-remuxed stream can't report its own duration reliably.
// The container each track is actually packaged in -- not reliably
// guessable from the codec string alone (YouTube serves vp9 in either mp4
// or webm depending on format, and av1 as mp4 despite webm supporting it
// too), so this has to come from whatever actually resolved the stream
// (e.g. yt-dlp's own reported format extension), not be re-derived
// downstream from vcodec/acodec.
const containerSchema = z.enum(['mp4', 'webm']);

// A subtitle/caption track an app already knows the URL for -- resolving
// one costs nothing beyond what resolveStream already does (yt-dlp's own
// info dump reports caption URLs alongside the stream itself, no separate
// network round trip), so unlike SkipSegment this rides along on
// ResolvedStream directly rather than needing its own request type. `url`
// stays server-side just like videoUrl/audioUrl -- never forwarded to the
// client as-is, only fetched through the streaming proxy (see
// src/routes/api/stream-subtitle) the same way the actual video/audio bytes
// are. Restricted to `vtt` (never `srt`/others): every app resolving
// through yt-dlp can ask for a vtt variant directly, so there's no format
// conversion for the host to own.
const subtitleTrackSchema = z.object({
	language: z.string(),
	// An app-provided display name (yt-dlp reports one for auto-generated
	// tracks, not always for manual ones) -- falls back to `language` itself
	// on the client when absent.
	label: z.string().optional(),
	// Manually authored (uploaded by the channel) vs. auto-generated
	// (speech-to-text) -- shown as a hint in the picker so "auto-generated"
	// tracks don't read as equally reliable as real ones.
	kind: z.enum(['caption', 'transcription']),
	url: z.string(),
	format: z.literal('vtt')
});
export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>;

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
	// all -- same "optional, treated as none" convention resolveSkipSegments
	// uses for an app with no handler registered.
	subtitleTracks: z.array(subtitleTrackSchema).optional()
});
export type ResolvedStream = z.infer<typeof resolvedStreamSchema>;

// `maxHeight`, when present, caps the requested video quality (see
// apps/youtube/stream.ts) -- always requesting the true "best" available
// stream regardless of what the network/CPU can actually remux and forward
// in real time is what made playback choppy in practice, so the player page
// lets the viewer pick a lower cap instead of always maxing this out.
export const resolveStreamParamsSchema = z.object({
	sessionId: z.string(),
	maxHeight: z.number().optional()
});
export const resolveStreamRequest = new RequestType<
	z.infer<typeof resolveStreamParamsSchema>,
	ResolvedStream,
	void
>('plugin/resolveStream');

// A skippable stretch of the video an app knows about (a SponsorBlock
// segment, for the YouTube app) -- generic over whatever the app's
// source for these actually is, the player only ever needs a time range and
// a label to show on the "prevent skip" button (see the player page).
const skipSegmentSchema = z.object({
	startSeconds: z.number(),
	endSeconds: z.number(),
	label: z.string()
});
export type SkipSegment = z.infer<typeof skipSegmentSchema>;

// Only called on an app whose manifest lists the `skipSegments` feature.
export const resolveSkipSegmentsParamsSchema = z.object({ sessionId: z.string() });
export const resolveSkipSegmentsResultSchema = z.object({ segments: z.array(skipSegmentSchema) });
export const resolveSkipSegmentsRequest = new RequestType<
	z.infer<typeof resolveSkipSegmentsParamsSchema>,
	z.infer<typeof resolveSkipSegmentsResultSchema>,
	void
>('plugin/resolveSkipSegments');

// What to play once a session has ended, for apps that play in sequence
// (a playlist). `context` is whatever the app put on the session action.
// No `sessionId` in the answer means there is nothing after this one.
export const resolveNextParamsSchema = z.object({
	sessionId: z.string(),
	context: z.string().optional()
});
export const resolveNextResultSchema = z.object({ sessionId: z.string().optional() });
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

// The host's language and region (a BCP 47 tag like `de-DE`), so an app can
// ask its backend for results in the language the person actually reads.
export const activateParamsSchema = z.object({ locale: z.string() });
export const activateNotification = new NotificationType<z.infer<typeof activateParamsSchema>>(
	'host/activate'
);

export const uiEventNotification = new NotificationType<z.infer<typeof uiEventSchema>>(
	'host/uiEvent'
);

// The host's language changed after the app started, e.g. the TV's browser
// language became known once a page was opened.
export const localeNotification = new NotificationType<z.infer<typeof activateParamsSchema>>(
	'host/locale'
);

export const shutdownNotification = new NotificationType0('host/shutdown');
