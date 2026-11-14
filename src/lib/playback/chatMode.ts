// How live chat shows next to a stream, picked on the TV or the phone.
// - outside: a column beside the video, which shrinks to make room
// - floating: a glass card over the video
// - embedded: just the lines over the video, no box
import * as m from '#lib/paraglide/messages';

export const CHAT_MODES = ['off', 'outside', 'floating', 'embedded'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

/** For values from storage or the phone, which may be anything. */
export function isChatMode(value: unknown): value is ChatMode {
	return (CHAT_MODES as readonly unknown[]).includes(value);
}

/** The picker's label for a mode, on the TV and the phone alike. */
export function chatModeLabel(mode: ChatMode): string {
	return {
		off: m.chat_mode_off,
		outside: m.chat_mode_outside,
		floating: m.chat_mode_floating,
		embedded: m.chat_mode_embedded
	}[mode]();
}
