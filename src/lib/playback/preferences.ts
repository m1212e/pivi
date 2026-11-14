import { readItem, writeItem, type KeyValueStorage } from '../storage';
import { isChatMode, type ChatMode } from './chatMode';

// Player settings remembered per TV browser, so they survive between videos.
// Storage may be unavailable, so every accessor takes null and falls back to defaults.
const VOLUME_KEY = 'pivi:player:volume';
const SKIP_ACTIVE_KEY = 'pivi:player:skipActive';
const SUBTITLE_KEY = 'pivi:player:subtitleLanguage';
const CHAT_OPEN_KEY = 'pivi:player:chatOpen';
const CHAT_MODE_KEY = 'pivi:player:chatMode';

/** Also guards volume values arriving from the phone. */
export function clampVolume(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Restores the last volume on the play page, full volume when nothing valid is stored. */
export function loadVolume(storage: KeyValueStorage | null): number {
	const stored = readItem(storage, VOLUME_KEY);
	if (stored === null) return 1;
	const value = Number(stored);
	return Number.isFinite(value) ? clampVolume(value) : 1;
}

/** Called by the play page whenever the volume changes. */
export function saveVolume(storage: KeyValueStorage | null, volume: number) {
	writeItem(storage, VOLUME_KEY, String(volume));
}

/** Initial state of the skip toggle. On by default, only people who want the sections need to opt out. */
export function loadSkipActive(storage: KeyValueStorage | null): boolean {
	const stored = readItem(storage, SKIP_ACTIVE_KEY);
	return stored === null ? true : stored === 'true';
}

/** Called by skipController whenever the toggle flips. */
export function saveSkipActive(storage: KeyValueStorage | null, active: boolean) {
	writeItem(storage, SKIP_ACTIVE_KEY, String(active));
}

/** Restores the viewer's last subtitle pick, null (off) when none. Only shows where the video offers it. */
export function loadSubtitleLanguage(storage: KeyValueStorage | null): string | null {
	return readItem(storage, SUBTITLE_KEY);
}

/** Called by the play page when a subtitle is picked on the TV or the phone. */
export function saveSubtitleLanguage(storage: KeyValueStorage | null, language: string | null) {
	writeItem(storage, SUBTITLE_KEY, language);
}

/** A phone may still show the previous session's tracks, so only offered languages count. */
export function isOfferedSubtitle(
	tracks: readonly { language: string }[],
	language: string | null
): boolean {
	return language === null || tracks.some((t) => t.language === language);
}

/** How live chat shows next to a stream that has one. Floating until changed once. */
export function loadChatMode(storage: KeyValueStorage | null): ChatMode {
	const stored = readItem(storage, CHAT_MODE_KEY);
	if (isChatMode(stored)) return stored;
	// The earlier on/off switch, carried over so an "off" stays off.
	return readItem(storage, CHAT_OPEN_KEY) === 'false' ? 'off' : 'floating';
}

/** Called by the play page when a chat mode is picked on the TV or the phone. */
export function saveChatMode(storage: KeyValueStorage | null, mode: ChatMode) {
	writeItem(storage, CHAT_MODE_KEY, mode);
}
