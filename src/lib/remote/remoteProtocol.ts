// JSON-RPC contract between the phone remote (remoteController.svelte.ts) and
// the TV (RemoteBridge.svelte), carried over the encrypted pairing channel.
// Each method comes with a zod schema so both ends validate what crosses the
// boundary (see rpc.ts) and can't drift apart.
import { NotificationType, NotificationType0 } from 'vscode-jsonrpc';
import { z } from 'zod';

// Phone -> TV

// Relative swipe distance, which the TV turns into a focus move (spatialNav.ts).
export const moveParamsSchema = z.object({ dx: z.number(), dy: z.number() });
export const moveNotification = new NotificationType<z.infer<typeof moveParamsSchema>>(
	'remote/move'
);

// Press and release instead of one tap, so a hold on the TV
// (HoldToConfirmButton.svelte) sees a real duration between the two.
export const selectPressNotification = new NotificationType0('remote/selectPress');
export const selectReleaseNotification = new NotificationType0('remote/selectRelease');
// Ends a press that turned into a swipe (trackpadGestures.ts), so nothing
// stays held on the TV and nothing gets clicked just because a swipe started.
export const selectCancelNotification = new NotificationType0('remote/selectCancel');
// Browser history back, offered while the TV reports `canGoBack`.
export const backNotification = new NotificationType0('remote/back');
// Jumps straight to /home however deep the TV is, unlike `back`.
export const goHomeNotification = new NotificationType0('remote/goHome');

// A digit from the phone's PIN tab, fed to the TV's PinPad without its key
// flash so nobody near the TV can read off the PIN.
export const keyParamsSchema = z.object({ value: z.string() });
export const keyNotification = new NotificationType<z.infer<typeof keyParamsSchema>>('remote/key');

// Replaces the focused TV field's value with the phone's copy on every edit.
export const textParamsSchema = z.object({ value: z.string() });
export const textNotification = new NotificationType<z.infer<typeof textParamsSchema>>(
	'remote/text'
);

// Whether the phone shows its own keyboard for text fields (as opposed to
// sitting on the trackpad). The TV only opens its on-screen keyboard when it
// does not, so the two never compete.
export const textEntryModeParamsSchema = z.object({ phoneKeyboard: z.boolean() });
export const textEntryModeNotification = new NotificationType<
	z.infer<typeof textEntryModeParamsSchema>
>('remote/textEntryMode');

// The phone picked one of the suggestions the TV listed in its state.
export const suggestionParamsSchema = z.object({ value: z.string() });
export const suggestionNotification = new NotificationType<z.infer<typeof suggestionParamsSchema>>(
	'remote/suggestion'
);

// Submits the focused TV field, the phone keyboard's enter key.
export const enterNotification = new NotificationType0('remote/enter');
// Leaves text entry on the focused field without submitting it.
export const exitTextNotification = new NotificationType0('remote/exitText');
// Sent once the session is up, so the phone doesn't wait for the TV's next change to render.
export const requestStateNotification = new NotificationType0('remote/requestState');

// A profile tapped in the phone's profile grid. Named by id because the
// phone has no focus on the TV to `select` with.
export const selectProfileParamsSchema = z.object({ id: z.string() });
export const selectProfileNotification = new NotificationType<
	z.infer<typeof selectProfileParamsSchema>
>('remote/selectProfile');

// Same as selectProfile, for the home dashboard's app shortcuts.
export const selectAppParamsSchema = z.object({ id: z.string() });
export const selectAppNotification = new NotificationType<z.infer<typeof selectAppParamsSchema>>(
	'remote/selectApp'
);

// The phone's player tab buttons. Sent as an action, not a click target,
// because some (the info toggle) have no single button on the TV to click.
export const playerActionParamsSchema = z.object({
	action: z.enum(['playPause', 'seekBack', 'seekForward', 'toggleInfo'])
});
export const playerActionNotification = new NotificationType<
	z.infer<typeof playerActionParamsSchema>
>('remote/playerAction');

// A drag on the phone's progress bar, an absolute position unlike seekBack/seekForward.
export const playerSeekParamsSchema = z.object({ seconds: z.number() });
export const playerSeekNotification = new NotificationType<z.infer<typeof playerSeekParamsSchema>>(
	'remote/playerSeek'
);

// A pick from the phone's quality list, mirrored from `qualityOptions`.
export const playerQualityParamsSchema = z.object({ quality: z.number() });
export const playerQualityNotification = new NotificationType<
	z.infer<typeof playerQualityParamsSchema>
>('remote/playerQuality');

// A pick from the phone's subtitle picker. `null` is the explicit "Off"
// choice, hence nullable rather than optional.
export const playerSubtitleParamsSchema = z.object({ language: z.string().nullable() });
export const playerSubtitleNotification = new NotificationType<
	z.infer<typeof playerSubtitleParamsSchema>
>('remote/playerSubtitle');

// A drag on the phone's volume slider, as an absolute 0..1 level.
export const playerVolumeParamsSchema = z.object({ volume: z.number() });
export const playerVolumeNotification = new NotificationType<
	z.infer<typeof playerVolumeParamsSchema>
>('remote/playerVolume');

// TV -> phone

// A pre-login profile, enough for the phone to draw the same picker tile.
const profileSchema = z.object({
	id: z.string(),
	username: z.string(),
	image: z.string().nullable()
});

// An app shortcut with the manifest's optional branding (manifest.ts), null when undeclared.
const appSchema = z.object({
	id: z.string(),
	name: z.string(),
	icon: z.string().nullable(),
	primaryColor: z.string().nullable(),
	secondaryColor: z.string().nullable()
});

// The player's SubtitleTrack minus `url`/`format`, since the phone only
// names a language back and never fetches a track.
const subtitleTrackSchema = z.object({
	language: z.string(),
	label: z.string().nullable(),
	kind: z.enum(['caption', 'transcription'])
});

// Snapshot of what the TV is showing, pushed so the phone can pick the matching
// input surface (see remoteTabs.ts) and mirror player state. The player fields
// are placeholders while `hasPlayer` is false.
export const stateParamsSchema = z.object({
	hasPinPad: z.boolean(),
	hasTextInput: z.boolean(),
	// What the focused text field holds right now, so the phone's keyboard
	// starts from it and follows edits made on the TV. Always empty for a
	// password field, since every paired phone gets this broadcast.
	textValue: z.string().default(''),
	textMasked: z.boolean().default(false),
	// Changes whenever a different field gets focus, so the phone can tell a
	// new password field from the one it is typing into.
	textFieldId: z.number().default(0),
	// Suggestions the focused text field offers, for the phone to show above
	// its keyboard.
	suggestions: z.array(z.string()).default([]),
	canGoBack: z.boolean(),
	// True only inside an app or the player, where "Home" goes somewhere new.
	canGoHome: z.boolean(),
	// The pre-login picker's profiles, empty elsewhere. Lets the phone offer
	// a direct tap instead of navigating there with the trackpad.
	profiles: z.array(profileSchema),
	// The home dashboard's first few app shortcuts, empty elsewhere. Shown
	// above the trackpad, not instead of it, since the dashboard still
	// needs it for navigating and scrolling.
	apps: z.array(appSchema),
	// True on /play/*, switches the phone to its player tab.
	hasPlayer: z.boolean(),
	// Lets the play/pause button show the action it would actually take.
	playing: z.boolean(),
	// So the phone can show and drag the same progress bar as the TV.
	position: z.number(),
	duration: z.number(),
	// The TV's own tiers, so the phone's picker never offers one the TV lacks.
	quality: z.number(),
	qualityOptions: z.array(z.number()),
	// Per-tier playback mode for the same icons as the TV's quality list,
	// keyed by quality as a string (JSON keys are). Missing means not known yet.
	qualityModes: z.record(z.string(), z.enum(['direct', 'mse', 'ffmpeg'])),
	// Caption tracks and the active one (`null` is off). Empty hides the
	// phone's picker, which is the usual case.
	subtitleTracks: z.array(subtitleTrackSchema),
	subtitleLanguage: z.string().nullable(),
	// Mirrored so the phone's info toggle can't fall out of sync with the TV.
	diagnosticsOpen: z.boolean(),
	// 0..1, so the phone's volume slider starts where the TV's is.
	volume: z.number()
});
export const stateNotification = new NotificationType<z.infer<typeof stateParamsSchema>>(
	'remote/state'
);

// Sent by the relay to the TV for its connect/disconnect toasts, with the
// device name (relay.ts's deriveDeviceName) so the toast says which phone.
export const remoteDeviceParamsSchema = z.object({ name: z.string() });
export const remoteConnectedNotification = new NotificationType<
	z.infer<typeof remoteDeviceParamsSchema>
>('remote/remoteConnected');
export const remoteDisconnectedNotification = new NotificationType<
	z.infer<typeof remoteDeviceParamsSchema>
>('remote/remoteDisconnected');

// A new phone asking to pair while another is connected. The relay waits for
// the TV's answer, see relay.ts's requestApproval.
export const pairingRequestParamsSchema = z.object({ requestId: z.string(), name: z.string() });
export const pairingRequestNotification = new NotificationType<
	z.infer<typeof pairingRequestParamsSchema>
>('remote/pairingRequest');
// The request was answered, timed out or the phone gave up, so the TV closes its prompt.
export const pairingRequestClosedParamsSchema = z.object({ requestId: z.string() });
export const pairingRequestClosedNotification = new NotificationType<
	z.infer<typeof pairingRequestClosedParamsSchema>
>('remote/pairingRequestClosed');
// TV -> relay only. The relay consumes it instead of forwarding it, so a
// phone never sees or sends one.
export const pairingDecisionParamsSchema = z.object({
	requestId: z.string(),
	approved: z.boolean()
});
export const pairingDecisionNotification = new NotificationType<
	z.infer<typeof pairingDecisionParamsSchema>
>('remote/pairingDecision');

/**
 * The only links the phone opens. Checked by the openUrlOnPhone mutation, by
 * the app screen sanitizer and again on the phone itself, so neither a buggy
 * host path nor something else on the TV's loopback can hand it a
 * javascript:, intent: or file: URL.
 */
export function isPhoneSafeUrl(raw: string): boolean {
	try {
		return new URL(raw).protocol === 'https:';
	} catch {
		return false;
	}
}

// Host -> phone, sent by the openUrlOnPhone mutation (handlers/remote.ts) so
// an app can finish a login, or anything needing a real browser, on the phone.
export const openUrlParamsSchema = z.object({ url: z.string().refine(isPhoneSafeUrl) });
export const openUrlNotification = new NotificationType<z.infer<typeof openUrlParamsSchema>>(
	'remote/openUrl'
);

// No wifi or app management messages on purpose. Both live on the TV's own
// screens (/wifi, /apps) and the phone only types into their fields.
