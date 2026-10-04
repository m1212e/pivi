import { NotificationType, NotificationType0 } from 'vscode-jsonrpc';
import { z } from 'zod';
import { featureSchema, permissionKeySchema } from '#lib/plugins/manifest';

// Phone -> TV

export const moveParamsSchema = z.object({ dx: z.number(), dy: z.number() });
export const moveNotification = new NotificationType<z.infer<typeof moveParamsSchema>>(
	'remote/move'
);

export const selectNotification = new NotificationType0('remote/select');
export const backNotification = new NotificationType0('remote/back');
// Distinct from `back` (browser history back, only shown when there's
// somewhere to go back to) — this always jumps straight to /home regardless
// of navigation depth, so it's shown unconditionally on the phone.
export const goHomeNotification = new NotificationType0('remote/goHome');

export const keyParamsSchema = z.object({ value: z.string() });
export const keyNotification = new NotificationType<z.infer<typeof keyParamsSchema>>('remote/key');

export const textParamsSchema = z.object({ value: z.string() });
export const textNotification = new NotificationType<z.infer<typeof textParamsSchema>>(
	'remote/text'
);

export const enterNotification = new NotificationType0('remote/enter');
export const requestStateNotification = new NotificationType0('remote/requestState');

// A profile tapped in the phone's own profile grid (see stateParamsSchema's
// `profiles` below) rather than a generic `select` -- the phone doesn't hold
// focus over any particular profile's element on the TV, so it has to name
// which one directly.
export const selectProfileParamsSchema = z.object({ id: z.string() });
export const selectProfileNotification = new NotificationType<
	z.infer<typeof selectProfileParamsSchema>
>('remote/selectProfile');

// Same idea as selectProfile, for one of the home dashboard's own app
// shortcuts (see stateParamsSchema's `apps` below).
export const selectAppParamsSchema = z.object({ id: z.string() });
export const selectAppNotification = new NotificationType<z.infer<typeof selectAppParamsSchema>>(
	'remote/selectApp'
);

// One of the player's own quick controls (see stateParamsSchema's
// `hasPlayer` below) -- dispatched as a plain DOM event on the TV (see
// RemoteBridge.svelte) rather than clicking a specific element, since a few
// of these (the info toggle) have no single button of their own to click in
// the first place.
export const playerActionParamsSchema = z.object({
	action: z.enum(['playPause', 'seekBack', 'seekForward', 'toggleInfo'])
});
export const playerActionNotification = new NotificationType<
	z.infer<typeof playerActionParamsSchema>
>('remote/playerAction');

// A drag on the phone's own progress bar -- a specific position rather than
// a relative nudge, unlike playerActionNotification's seekBack/seekForward,
// so it needs its own params.
export const playerSeekParamsSchema = z.object({ seconds: z.number() });
export const playerSeekNotification = new NotificationType<z.infer<typeof playerSeekParamsSchema>>(
	'remote/playerSeek'
);

// A tap on one of the phone's quality options (see stateParamsSchema's
// `qualityOptions` below).
export const playerQualityParamsSchema = z.object({ quality: z.number() });
export const playerQualityNotification = new NotificationType<
	z.infer<typeof playerQualityParamsSchema>
>('remote/playerQuality');

// A pick from the phone's own subtitle picker (see stateParamsSchema's
// `subtitleTracks` below) -- `null` is the "Off" option, which is a real
// choice here rather than an absent one, so the field is nullable rather
// than optional.
export const playerSubtitleParamsSchema = z.object({ language: z.string().nullable() });
export const playerSubtitleNotification = new NotificationType<
	z.infer<typeof playerSubtitleParamsSchema>
>('remote/playerSubtitle');

// A drag on the phone's own volume slider -- an absolute 0..1 level rather
// than playerActionNotification's volumeUp/volumeDown nudges, so it needs
// its own params too.
export const playerVolumeParamsSchema = z.object({ volume: z.number() });
export const playerVolumeNotification = new NotificationType<
	z.infer<typeof playerVolumeParamsSchema>
>('remote/playerVolume');

// Wifi provisioning (phone -> host). Unlike every other notification in this
// "Phone -> TV" section, these three are handled by the *server* rather than
// relayed to the TV's browser (see src/api/wifiCommands.ts): joining a network
// is an OS-level operation, and routing it through the TV page would mean
// giving that page a privileged endpoint of its own and would break whenever
// the TV happens to be showing something else.

export const wifiRequestStateNotification = new NotificationType0('wifi/requestState');
export const wifiScanNotification = new NotificationType0('wifi/scan');

export const wifiConnectParamsSchema = z.object({
	ssid: z.string().min(1),
	// Empty for an open network. Never echoed back to the phone, and never
	// logged — it goes straight to NetworkManager, which owns storing it.
	password: z.string(),
	// A network that doesn't broadcast its SSID has to be typed in by hand, and
	// needs telling NetworkManager to probe for it explicitly.
	hidden: z.boolean().default(false)
});
export const wifiConnectNotification = new NotificationType<
	z.input<typeof wifiConnectParamsSchema>
>('wifi/connect');

// TV -> phone

const profileSchema = z.object({
	id: z.string(),
	username: z.string(),
	image: z.string().nullable()
});

const appSchema = z.object({ id: z.string(), name: z.string() });

// Mirrors the player page's own SubtitleTrack -- `url`/`format` deliberately
// stay on the TV side (the phone only ever names a language back, never
// fetches a track itself).
const subtitleTrackSchema = z.object({
	language: z.string(),
	label: z.string().nullable(),
	kind: z.enum(['caption', 'transcription'])
});

export const stateParamsSchema = z.object({
	hasPinPad: z.boolean(),
	hasTextInput: z.boolean(),
	canGoBack: z.boolean(),
	// Whether the "Home" button on the phone is worth showing -- true only
	// while the TV is actually inside an app or the player, i.e. somewhere
	// "Home" would take it somewhere new. Not shown on the home screen
	// itself (nothing to go home to) or on the pre-login profile picker.
	canGoHome: z.boolean(),
	// The pre-login picker's own profiles, straight from its DOM (see
	// RemoteBridge.svelte's sendState) -- empty everywhere else. Lets the
	// phone show the exact same grid for a direct tap-to-select instead of
	// only offering the trackpad to spatially navigate to one.
	profiles: z.array(profileSchema),
	// The home dashboard's first few app shortcuts, straight from its DOM
	// (see RemoteBridge.svelte's sendState) -- empty everywhere else. Shown
	// above the trackpad rather than replacing it, since the dashboard is
	// still the trackpad's own home turf for spatial navigation and
	// scrolling.
	apps: z.array(appSchema),
	// Whether the player's own quick controls are worth showing instead of
	// just the trackpad -- true on /play/*, straight off the same
	// `data-pivi-player` marker RemoteBridge.svelte dispatches
	// playerActionNotification through.
	hasPlayer: z.boolean(),
	// Whether the player is actually playing right now, straight off the
	// `<video>` element's own `paused` property -- lets the phone's play/pause
	// button show the action it would actually take instead of a fixed icon.
	// Meaningless (and always false) whenever `hasPlayer` is false.
	playing: z.boolean(),
	// Straight off the player page's own `position`/`duration` -- lets the
	// phone show and drag the exact same progress bar the TV does. Meaningless
	// (and always 0) whenever `hasPlayer` is false.
	position: z.number(),
	duration: z.number(),
	// The currently-selected quality tier and the full list of tiers the TV
	// offers, so the phone can render the same picker instead of guessing at
	// its own set of options. Meaningless whenever `hasPlayer` is false.
	quality: z.number(),
	qualityOptions: z.array(z.number()),
	// Per-tier direct/mse/ffmpeg indicator, keyed by quality (as a string --
	// JSON object keys always are) -- same icons as the TV's own quality
	// list. A tier missing from this map means its mode isn't known yet, same
	// as the TV showing no icon for it.
	qualityModes: z.record(z.string(), z.enum(['direct', 'mse', 'ffmpeg'])),
	// The session's caption tracks and which one is showing right now (`null`
	// = off), so the phone can render the same picker the TV does. Empty
	// whenever the session has no tracks at all (most of them) or `hasPlayer`
	// is false, which is also the phone's cue not to show the picker.
	subtitleTracks: z.array(subtitleTrackSchema),
	subtitleLanguage: z.string().nullable(),
	// Whether the TV's own playback-diagnostics panel is open right now, so
	// the phone's info toggle reflects it instead of tracking its own,
	// possibly out-of-sync, guess. Meaningless whenever `hasPlayer` is false.
	diagnosticsOpen: z.boolean(),
	// The player's own current volume (0..1), straight off the `<video>`
	// element -- lets the phone show and drag the exact same volume slider
	// the TV does. Meaningless (and always 0) whenever `hasPlayer` is false.
	volume: z.number()
});
export const stateNotification = new NotificationType<z.infer<typeof stateParamsSchema>>(
	'remote/state'
);

// Carries the paired device's own name (see relay.ts's deriveDeviceName) so
// the TV's toast can say which phone rather than just "a phone".
export const remoteDeviceParamsSchema = z.object({ name: z.string() });
export const remoteConnectedNotification = new NotificationType<
	z.infer<typeof remoteDeviceParamsSchema>
>('remote/remoteConnected');
export const remoteDisconnectedNotification = new NotificationType<
	z.infer<typeof remoteDeviceParamsSchema>
>('remote/remoteDisconnected');

// Host -> phone, sent directly (not via the TV's own connection — see
// relay.ts's sendToPhones) whenever a plugin publishes a PhoneAuthHandoff
// (src/lib/plugins/auth.ts). Generic on purpose: any plugin that needs the
// phone to complete a login (or, someday, anything else that needs a real
// browser tab) gets this for free rather than building its own version.
export const openUrlParamsSchema = z.object({ url: z.string() });
export const openUrlNotification = new NotificationType<z.infer<typeof openUrlParamsSchema>>(
	'remote/openUrl'
);

// Host -> phone, sent directly via relay.ts's sendToPhones (the server answers
// the three wifi notifications above itself, so these never pass through the
// TV). Also pushed unprompted when provisioning changes the device's own state
// — a join succeeding or failing — so the phone doesn't have to poll for the
// outcome of something it asked for.
const wifiNetworkSchema = z.object({
	ssid: z.string(),
	signal: z.number(),
	security: z.enum(['open', 'wep', 'wpa', 'enterprise']),
	saved: z.boolean()
});

export const wifiStateParamsSchema = z.object({
	// False when NetworkManager isn't reachable at all (a development machine,
	// or a deployment without it) — the phone shows "not available here" rather
	// than an empty network list that looks like a failed scan.
	available: z.boolean(),
	mode: z.enum(['client', 'hotspot', 'disconnected']),
	ssid: z.string().nullable(),
	online: z.boolean(),
	ethernet: z.boolean(),
	// Whether a join is in flight right now. The phone that asked for it
	// already knows, but a second phone (or the same one after a reload) has no
	// other way to tell -- which is also why the target SSID travels with it
	// rather than being remembered client-side.
	connecting: z.boolean(),
	connectingSsid: z.string().nullable(),
	// Result of the last join attempt, cleared when the next one starts. Null
	// when the last attempt succeeded or none has been made.
	error: z.string().nullable(),
	// Null until a scan has completed, which is what distinguishes "no scan yet"
	// from "scanned and found nothing".
	networks: z.array(wifiNetworkSchema).nullable()
});
export const wifiStateNotification = new NotificationType<z.infer<typeof wifiStateParamsSchema>>(
	'wifi/state'
);

// Plugin management (phone -> host). Like the wifi notifications, these are
// answered by the *server* (src/api/pluginCommands.ts) rather than relayed to the
// TV's browser: installing code and deciding what it may do is exactly the kind
// of operation that must only ever come over the paired, encrypted connection,
// never from the unauthenticated page on the TV.

export const pluginsRequestStateNotification = new NotificationType0('plugins/requestState');

// Resolve an image and check its signature, without installing anything — the
// answer is what the phone shows for the user to accept.
export const pluginsPreviewParamsSchema = z.object({
	image: z.string().min(1),
	// The publisher's cosign public key (PEM): what the image has to be signed by.
	publicKey: z.string().min(1)
});
export const pluginsPreviewNotification = new NotificationType<
	z.infer<typeof pluginsPreviewParamsSchema>
>('plugins/preview');

// Installs what was last previewed (the host holds it — the preview may have been
// made on the other screen), with the permissions the user left switched on.
export const pluginsInstallParamsSchema = z.object({
	granted: z.array(permissionKeySchema)
});
export const pluginsInstallNotification = new NotificationType<
	z.infer<typeof pluginsInstallParamsSchema>
>('plugins/install');

export const pluginsDismissPreviewNotification = new NotificationType0('plugins/dismissPreview');

export const pluginIdParamsSchema = z.object({ pluginId: z.string() });
export const pluginsUninstallNotification = new NotificationType<
	z.infer<typeof pluginIdParamsSchema>
>('plugins/uninstall');
export const pluginsApproveUpdateNotification = new NotificationType<
	z.infer<typeof pluginIdParamsSchema>
>('plugins/approveUpdate');
export const pluginsRejectUpdateNotification = new NotificationType<
	z.infer<typeof pluginIdParamsSchema>
>('plugins/rejectUpdate');
export const pluginsClearCacheNotification = new NotificationType<
	z.infer<typeof pluginIdParamsSchema>
>('plugins/clearCache');
export const pluginsCheckUpdatesNotification = new NotificationType0('plugins/checkUpdates');

export const pluginsSetEnabledParamsSchema = pluginIdParamsSchema.extend({ enabled: z.boolean() });
export const pluginsSetEnabledNotification = new NotificationType<
	z.infer<typeof pluginsSetEnabledParamsSchema>
>('plugins/setEnabled');

export const pluginsSetAutoUpdateParamsSchema = pluginIdParamsSchema.extend({
	autoUpdate: z.boolean()
});
export const pluginsSetAutoUpdateNotification = new NotificationType<
	z.infer<typeof pluginsSetAutoUpdateParamsSchema>
>('plugins/setAutoUpdate');

export const pluginsSetPermissionParamsSchema = pluginIdParamsSchema.extend({
	permission: permissionKeySchema,
	granted: z.boolean()
});
export const pluginsSetPermissionNotification = new NotificationType<
	z.infer<typeof pluginsSetPermissionParamsSchema>
>('plugins/setPermission');

// Host -> phone

const pluginPermissionSchema = z.object({ key: permissionKeySchema, granted: z.boolean() });

const pluginUpdateSchema = z.object({
	version: z.string(),
	addedPermissions: z.array(permissionKeySchema),
	addedDomains: z.array(z.string())
});

const installedPluginSchema = z.object({
	id: z.string(),
	name: z.string(),
	version: z.string(),
	image: z.string(),
	enabled: z.boolean(),
	autoUpdate: z.boolean(),
	features: z.array(featureSchema),
	permissions: z.array(pluginPermissionSchema),
	// What the `network` permission covers, verbatim, so the user sees exactly
	// which domains a single toggle opens up.
	domains: z.array(z.string()),
	signerFingerprint: z.string(),
	// A newer version waiting for the user to approve what it asks for.
	update: pluginUpdateSchema.nullable(),
	error: z.string().nullable()
});

const pluginPreviewSchema = z.object({
	image: z.string(),
	name: z.string(),
	version: z.string(),
	features: z.array(featureSchema),
	permissions: z.array(permissionKeySchema),
	domains: z.array(z.string()),
	signerFingerprint: z.string(),
	conflict: z.boolean()
});

export const pluginsStateParamsSchema = z.object({
	plugins: z.array(installedPluginSchema),
	preview: pluginPreviewSchema.nullable(),
	// What the host is in the middle of, so a phone that reloads (or a second
	// one) shows the same thing as the one that asked.
	busy: z.enum(['previewing', 'installing', 'checking', 'working']).nullable(),
	error: z.string().nullable()
});
export const pluginsStateNotification = new NotificationType<
	z.infer<typeof pluginsStateParamsSchema>
>('plugins/state');
