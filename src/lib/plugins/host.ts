// The plugin<->host RPC boundary (see SKETCH.md's "Plugin sandboxing"
// decision): one child process per plugin, everything it can do or be told
// crosses this channel as a JSON-RPC 2.0 call over vscode-jsonrpc — the
// same library (and the same request/notification split) the Language
// Server Protocol uses for its editor<->language-server child process, which
// is the model this is copying. Using it instead of a hand-rolled message
// envelope also means request/response correlation (matching a response
// back to its request) is handled by the library instead of by us — no more
// manually-paired httpRequest/httpResponse messages with a requestId to
// track by hand.
import { NotificationType, NotificationType0, RequestType, RequestType0 } from 'vscode-jsonrpc';
import { z } from 'zod';
import { pluginManifestSchema } from './manifest';
import { dashboardContributionSchema } from './dashboard';
import { pluginScreenSchema, uiEventSchema } from './ui';
import { deviceCodeAuthSchema, phoneAuthHandoffSchema } from './auth';

// Plugin -> host

export const readyNotification = new NotificationType<z.infer<typeof pluginManifestSchema>>(
	'plugin/ready'
);

export const publishDashboardNotification = new NotificationType<
	z.infer<typeof dashboardContributionSchema>
>('plugin/publishDashboard');

export const publishScreenNotification = new NotificationType<z.infer<typeof pluginScreenSchema>>(
	'plugin/publishScreen'
);

// Any plugin that wants in-browser playback implements this same handler
// shape — the host never knows anything about a particular plugin's stream
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

// A subtitle/caption track a plugin already knows the URL for -- resolving
// one costs nothing beyond what resolveStream already does (yt-dlp's own
// info dump reports caption URLs alongside the stream itself, no separate
// network round trip), so unlike SkipSegment this rides along on
// ResolvedStream directly rather than needing its own request type. `url`
// stays server-side just like videoUrl/audioUrl -- never forwarded to the
// client as-is, only fetched through the streaming proxy (see
// src/routes/api/stream-subtitle) the same way the actual video/audio bytes
// are. Restricted to `vtt` (never `srt`/others): every plugin resolving
// through yt-dlp can ask for a vtt variant directly, so there's no format
// conversion for the host to own.
const subtitleTrackSchema = z.object({
	language: z.string(),
	// A plugin-provided display name (yt-dlp reports one for auto-generated
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
	// Absent (not just empty) for a plugin that has no subtitle source at
	// all -- same "optional, treated as none" convention resolveSkipSegments
	// uses for a plugin with no handler registered.
	subtitleTracks: z.array(subtitleTrackSchema).optional()
});
export type ResolvedStream = z.infer<typeof resolvedStreamSchema>;

// `maxHeight`, when present, caps the requested video quality (see
// plugins/youtube/stream.ts) -- always requesting the true "best" available
// stream regardless of what the network/CPU can actually remux and forward
// in real time is what made playback choppy in practice, so the player page
// lets the viewer pick a lower cap instead of always maxing this out.
export const resolveStreamRequest = new RequestType<
	{ sessionId: string; maxHeight?: number },
	ResolvedStream,
	void
>('plugin/resolveStream');

// A skippable stretch of the video a plugin knows about (a SponsorBlock
// segment, for the YouTube plugin) -- generic over whatever the plugin's
// source for these actually is, the player only ever needs a time range and
// a label to show on the "prevent skip" button (see the player page).
export const skipSegmentSchema = z.object({
	startSeconds: z.number(),
	endSeconds: z.number(),
	label: z.string()
});
export type SkipSegment = z.infer<typeof skipSegmentSchema>;

// Not every plugin has a source for these -- one that doesn't just never
// implements this request, which runtime.ts's resolveSkipSegments treats the
// same as "no skippable sections" rather than a hard failure.
export const resolveSkipSegmentsRequest = new RequestType<
	{ sessionId: string },
	{ segments: SkipSegment[] },
	void
>('plugin/resolveSkipSegments');

export const pluginAuthSchema = z.union([deviceCodeAuthSchema, phoneAuthHandoffSchema]);

export const publishAuthNotification = new NotificationType<z.infer<typeof pluginAuthSchema>>(
	'plugin/publishAuth'
);

// A plain, JSON-serializable subset of fetch's RequestInit — everything
// crossing this boundary goes over JSON, so no AbortSignal/streaming body.
export const httpRequestParamsSchema = z.object({
	url: z.string(),
	method: z.string().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	body: z.string().optional()
});
type HttpRequestParams = z.infer<typeof httpRequestParamsSchema>;

export const httpResponseResultSchema = z.object({
	status: z.number(),
	headers: z.record(z.string(), z.string()),
	body: z.string()
});
type HttpResponseResult = z.infer<typeof httpResponseResultSchema>;

// The plugin process has no direct network access beyond what its manifest
// declares — outbound requests are proxied through the host, which enforces
// the declared domain allowlist per call.
export const httpRequestRequest = new RequestType<HttpRequestParams, HttpResponseResult, void>(
	'plugin/httpRequest'
);

export const logParamsSchema = z.object({
	level: z.enum(['info', 'warn', 'error']),
	message: z.string()
});

export const logNotification = new NotificationType<z.infer<typeof logParamsSchema>>('plugin/log');

// Opaque to the host — a plugin-defined JSON blob (an OAuth refresh token,
// for the YouTube plugin). The host stamps the requesting plugin's id and
// the currently active profile's user id onto the storage key itself; a
// plugin has no way to name a different plugin or user, so it can only ever
// reach its own credential for whoever is signed in right now.
export const credentialSetParamsSchema = z.object({ value: z.string() });

export const credentialSetRequest = new RequestType<
	z.infer<typeof credentialSetParamsSchema>,
	void,
	void
>('plugin/credentialSet');

export const credentialGetResultSchema = z.object({ value: z.string().nullable() });

export const credentialGetRequest = new RequestType0<
	z.infer<typeof credentialGetResultSchema>,
	void
>('plugin/credentialGet');

// A plugin building a PhoneAuthHandoff's redirect_uri needs to know a base
// URL the phone can actually reach (a LAN address, not localhost) — only
// the host knows that. Generic on purpose: any plugin doing a redirect-based
// login needs this, not just one that happens to be OAuth.
export const publicOriginResultSchema = z.object({ origin: z.string() });

export const getPublicOriginRequest = new RequestType0<
	z.infer<typeof publicOriginResultSchema>,
	void
>('plugin/getPublicOrigin');

// Host -> plugin

export const activateNotification = new NotificationType0('host/activate');

export const uiEventNotification = new NotificationType<z.infer<typeof uiEventSchema>>(
	'host/uiEvent'
);

// Delivered once the phone completes a PhoneAuthHandoff and Google (or
// whatever the plugin's login provider is) redirects back to pivi's own
// server — see src/routes/oauth/callback and src/api/plugins/pendingAuth.ts.
// No zod schema behind this one (unlike the rest of the file): the host
// constructs `{ code, state }` itself from its own already-validated data, so
// there's nothing to parse here, just a shape to describe.
export const oauthCodeNotification = new NotificationType<{ code: string; state: string }>(
	'host/oauthCode'
);

export const shutdownNotification = new NotificationType0('host/shutdown');

// Sent whenever which pivi profile is active changes (login/logout) -- lets
// a plugin swap any account-bound state (YouTube's signed-in session, for
// this plugin) over to whichever profile is active now instead of staying
// stuck on whoever was active when the plugin process started. No payload:
// a plugin re-derives "whose credential is this" the same way it always
// does, through credentialGetRequest, which the host already resolves
// against the current active profile.
export const profileChangedNotification = new NotificationType0('host/profileChanged');
