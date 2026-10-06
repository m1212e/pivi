// The player page's side of its contract with RemoteBridge. The phone drives
// playback through DOM events and RemoteBridge reads state back off data
// attributes, so neither side needs to know how the other is implemented.
import { DOM_EVENTS } from '#lib/domEvents';
import { clampVolume, isOfferedSubtitle } from './preferences';
import { QUALITY_OPTIONS, isQualityOption, type QualityMode, type QualityOption } from './quality';

/** Transport buttons on the phone's player tab, dispatched by RemoteBridge as `DOM_EVENTS.playerAction`. */
export type PlayerAction = 'playPause' | 'seekBack' | 'seekForward' | 'toggleInfo';

/** How the play page reacts to each phone command. */
export type RemoteHandlers = {
	onAction: (action: PlayerAction) => void;
	onSeek: (seconds: number) => void;
	onQuality: (quality: QualityOption) => void;
	/** Only called for null (off) or a language the session actually offers. */
	onSubtitle: (language: string | null) => void;
	onVolume: (volume: number) => void;
	getSubtitleTracks: () => readonly { language: string }[];
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
			if (isQualityOption(quality)) handlers.onQuality(quality);
		}),
		listen<{ language: string | null }>(DOM_EVENTS.playerSubtitle, ({ language }) => {
			if (isOfferedSubtitle(handlers.getSubtitleTracks(), language)) handlers.onSubtitle(language);
		}),
		listen<{ volume: number }>(DOM_EVENTS.playerVolume, ({ volume }) =>
			handlers.onVolume(clampVolume(volume))
		)
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
	quality: QualityOption;
	qualityModes: Partial<Record<QualityOption, QualityMode>>;
	subtitleLanguage: string | null;
	subtitleTracks: readonly { language: string; label: string | null; kind: string }[];
	diagnosticsOpen: boolean;
	volume: number;
};

/** Attributes for the player's root element, the state RemoteBridge mirrors onto the phone. */
export function playerBridgeAttributes(state: BridgeState) {
	return {
		'data-pivi-player': '',
		'data-pivi-player-position': state.position,
		'data-pivi-player-duration': state.duration,
		'data-pivi-player-quality': state.quality,
		'data-pivi-player-quality-options': QUALITY_OPTIONS.join(','),
		'data-pivi-player-quality-modes': JSON.stringify(state.qualityModes),
		// An attribute can't carry null, empty string stands for off.
		'data-pivi-player-subtitle-language': state.subtitleLanguage ?? '',
		'data-pivi-player-subtitle-tracks': JSON.stringify(state.subtitleTracks),
		'data-pivi-player-diagnostics-open': state.diagnosticsOpen,
		'data-pivi-player-volume': state.volume
	};
}
