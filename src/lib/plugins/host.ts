// The plugin<->host RPC boundary (see SKETCH.md's "Plugin sandboxing"
// decision). A plugin is an OCI image whose entrypoint speaks JSON-RPC 2.0 over
// its stdin/stdout, one JSON message per line (see ndjson.ts), with logs on
// stderr — so it can be written in any language, and nothing in this file
// assumes one. vscode-jsonrpc is only the host's (and the TypeScript SDK's)
// way of speaking it: request/response correlation is handled by the library
// instead of by hand. The same method names and schemas are published as JSON
// Schema (protocolSchema.ts, docs/plugin-protocol.schema.json) for every other
// language.
import { NotificationType, NotificationType0, RequestType, RequestType0 } from 'vscode-jsonrpc';
import { z } from 'zod';
import { dashboardContributionSchema } from './dashboard';
import { pluginScreenSchema, uiEventSchema } from './ui';
import { deviceCodeAuthSchema, phoneAuthHandoffSchema } from './auth';

// Plugin -> host

// The version of this protocol; a plugin's manifest names the one it speaks
// (`protocol`), and the host refuses to run one it doesn't support.
export const PROTOCOL_VERSION = 1;
export const SUPPORTED_PROTOCOLS: readonly number[] = [PROTOCOL_VERSION];

// The first message a plugin sends, once it can receive requests. Carries
// nothing but the protocol version: what the plugin is and what it may do is
// its manifest, which the host already read from the image and the user
// already approved — never something a running plugin gets to restate.
export const readyParamsSchema = z.object({ protocol: z.number().int().positive() });
export const readyNotification = new NotificationType<z.infer<typeof readyParamsSchema>>(
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
export const resolveStreamParamsSchema = z.object({
	sessionId: z.string(),
	maxHeight: z.number().optional()
});
export const resolveStreamRequest = new RequestType<
	z.infer<typeof resolveStreamParamsSchema>,
	ResolvedStream,
	void
>('plugin/resolveStream');

// A skippable stretch of the video a plugin knows about (a SponsorBlock
// segment, for the YouTube plugin) -- generic over whatever the plugin's
// source for these actually is, the player only ever needs a time range and
// a label to show on the "prevent skip" button (see the player page).
const skipSegmentSchema = z.object({
	startSeconds: z.number(),
	endSeconds: z.number(),
	label: z.string()
});
export type SkipSegment = z.infer<typeof skipSegmentSchema>;

// Only called on a plugin whose manifest lists the `skipSegments` feature.
export const resolveSkipSegmentsParamsSchema = z.object({ sessionId: z.string() });
export const resolveSkipSegmentsResultSchema = z.object({ segments: z.array(skipSegmentSchema) });
export const resolveSkipSegmentsRequest = new RequestType<
	z.infer<typeof resolveSkipSegmentsParamsSchema>,
	z.infer<typeof resolveSkipSegmentsResultSchema>,
	void
>('plugin/resolveSkipSegments');

export const pluginAuthSchema = z.union([deviceCodeAuthSchema, phoneAuthHandoffSchema]);

export const publishAuthNotification = new NotificationType<z.infer<typeof pluginAuthSchema>>(
	'plugin/publishAuth'
);

// Outbound network access isn't an RPC: it's the `network` permission, enforced
// by the sandbox for exactly the manifest's declared domains (see
// src/api/plugins/sandbox). Likewise persistent and disposable state are the
// `storage` and `cache` volumes mounted into the container, and logs are just
// the process's stderr.

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
export const oauthCodeParamsSchema = z.object({ code: z.string(), state: z.string() });
export const oauthCodeNotification = new NotificationType<z.infer<typeof oauthCodeParamsSchema>>(
	'host/oauthCode'
);

export const shutdownNotification = new NotificationType0('host/shutdown');
