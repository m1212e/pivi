import type { TextTarget } from '#lib/textEntry';

// State of the on-screen keyboard, kept outside the component so the remote
// bridge and the text field can talk to it without importing each other.
export const osk = $state({
	// The field being typed into. Focus moves to the keys while typing, so this
	// is what the phone relay and the keys edit instead of the focused element.
	target: null as TextTarget | null,
	// The field the user closed the keyboard on, so refocusing it does not
	// reopen the keyboard right away.
	dismissed: null as TextTarget | null,
	// The paired phone shows its own keyboard for text fields, so the on-screen
	// one stays out of the way. False without a phone.
	phoneKeyboard: false,
	// Suggestions offered by the field that owns `owner`.
	suggestions: { owner: null as Element | null, items: [] as string[] }
});

export function keyboardVisible(): boolean {
	return !!osk.target && osk.target.isConnected && !osk.phoneKeyboard;
}

/**
 * Closes the keyboard and ends editing on the field. Returns whether there was
 * a keyboard to close, so a Back press can fall through to normal navigation.
 */
export function dismissKeyboard(): boolean {
	const target = osk.target;
	if (!target || !keyboardVisible()) return false;
	// A field that manages its own editing state (TextInput) closes on Escape.
	target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	// Still ours means the field did not move focus away on its own.
	if (osk.target === target) {
		osk.dismissed = target;
		osk.target = null;
		target.focus();
	}
	return true;
}
