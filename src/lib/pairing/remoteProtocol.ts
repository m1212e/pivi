import { NotificationType, NotificationType0 } from 'vscode-jsonrpc';
import { z } from 'zod';

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
