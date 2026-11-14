// The player page's side of its contract with RemoteBridge. The phone drives
// playback through DOM events and RemoteBridge reads state back off data
// attributes, so neither side needs to know how the other is implemented.
import { DOM_EVENTS } from '#lib/domEvents';
import { clampVolume, isOfferedSubtitle } from './preferences';
import { isOfferedQuality, type QualityMode, type QualityOption } from './quality';
import { isChatMode, type ChatMode } from './chatMode';

/** Transport buttons on the phone's player tab, dispatched by RemoteBridge as `DOM_EVENTS.playerAction`. */
export type PlayerAction = 'playPause' | 'seekBack' | 'seekForward' | 'toggleInfo' | 'goToLive';

/** How the play page reacts to each phone command. */
export type RemoteHandlers = {
	onAction: (action: PlayerAction) => void;
	onSeek: (seconds: number) => void;
	/** Only called for a tier the session actually offers. */
	onQuality: (quality: QualityOption) => void;
	/** Only called for null (off) or a language the session actually offers. */
	onSubtitle: (language: string | null) => void;
	onVolume: (volume: number) => void;
	/** Only called with a valid mode. */
	onChatMode: (mode: ChatMode) => void;
	getSubtitleTracks: () => readonly { language: string }[];
	getQualities: () => readonly QualityOption[];
};

function listen<T>(name: string, handler: (detail: T) => void): () => void {
	const listener = (event: Event) => handler((event as CustomEvent<T>).detail);
	document.addEventListener(name, listener);
	return () => document.removeEventListener(name, listener);
}

/**
 * Lets the paired phone drive the TV player. Values are validated here so the
 * page gets clean input. Seek and quality skip the controls lock on purpose.
 * Returns the cleanup, so it fits an $effect.
 */
export function bindRemotePlayerEvents(handlers: RemoteHandlers): () => void {
	const unbind = [
		listen<{ action: PlayerAction }>(DOM_EVENTS.playerAction, ({ action }) =>
			handlers.onAction(action)
		),
		listen<{ seconds: number }>(DOM_EVENTS.playerSeek, ({ seconds }) => handlers.onSeek(seconds)),
		listen<{ quality: number }>(DOM_EVENTS.playerQuality, ({ quality }) => {
			if (isOfferedQuality(handlers.getQualities(), quality)) handlers.onQuality(quality);
		}),
		listen<{ language: string | null }>(DOM_EVENTS.playerSubtitle, ({ language }) => {
			if (isOfferedSubtitle(handlers.getSubtitleTracks(), language)) handlers.onSubtitle(language);
		}),
		listen<{ volume: number }>(DOM_EVENTS.playerVolume, ({ volume }) =>
			handlers.onVolume(clampVolume(volume))
		),
		listen<{ mode: unknown }>(DOM_EVENTS.playerChatMode, ({ mode }) => {
			if (isChatMode(mode)) handlers.onChatMode(mode);
		})
	];
	return () => unbind.forEach((fn) => fn());
}

/**
 * Tells RemoteBridge to re-read the player's data attributes. Needed for
 * changes that cause no DOM mutation it would notice by itself.
 */
export function announcePlayerStateChange() {
	document.dispatchEvent(new CustomEvent(DOM_EVENTS.playerStateChanged));
}

type BridgeState = {
	position: number;
	duration: number;
	qualities: readonly QualityOption[];
	quality: QualityOption | undefined;
	qualityModes: Partial<Record<QualityOption, QualityMode>>;
	subtitleLanguage: string | null;
	subtitleTracks: readonly { language: string; label: string | null; kind: string }[];
	diagnosticsOpen: boolean;
	volume: number;
	controls: Record<string, boolean>;
	// Null unless the stream is live.
	live: { viewers: number | null; latency: number | null } | null;
	chat: { available: boolean; mode: ChatMode };
};

/** Attributes for the player's root element, the state RemoteBridge mirrors onto the phone. */
export function playerBridgeAttributes(state: BridgeState) {
	return {
		'data-pivi-player': '',
		'data-pivi-player-position': state.position,
		'data-pivi-player-duration': state.duration,
		'data-pivi-player-quality': state.quality,
		'data-pivi-player-quality-options': state.qualities.join(','),
		'data-pivi-player-quality-modes': JSON.stringify(state.qualityModes),
		// An attribute can't carry null, empty string stands for off.
		'data-pivi-player-subtitle-language': state.subtitleLanguage ?? '',
		'data-pivi-player-subtitle-tracks': JSON.stringify(state.subtitleTracks),
		'data-pivi-player-diagnostics-open': state.diagnosticsOpen,
		'data-pivi-player-volume': state.volume,
		'data-pivi-player-controls': JSON.stringify(state.controls),
		// Rounded, so the phone isn't pushed a new state for every fraction of a second.
		'data-pivi-player-live': JSON.stringify(
			state.live && {
				viewers: state.live.viewers,
				latency: state.live.latency === null ? null : Math.round(state.live.latency)
			}
		),
		'data-pivi-player-chat': JSON.stringify(state.chat)
	};
}
