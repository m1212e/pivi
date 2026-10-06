// TV fields get typed into without a physical keyboard, from the phone
// (RemoteBridge) and the on-screen keyboard. Shared so both edit a field the
// way a real keystroke would and TextField reacts the same to either.

/** Elements the phone relay and on-screen keyboard can type into. */
export type TextTarget = HTMLInputElement | HTMLTextAreaElement;

// Input types where typed characters make sense.
const TEXTUAL_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password']);

/**
 * Decides whether RemoteBridge and the on-screen keyboard treat the focused
 * element as typeable. A checkbox or slider is focusable but is not.
 */
export function isTextualInput(el: Element | null): el is TextTarget {
	if (el instanceof HTMLTextAreaElement) return true;
	return el instanceof HTMLInputElement && TEXTUAL_INPUT_TYPES.has(el.type);
}

/**
 * Mirrors the phone's text into the TV field. Goes through the prototype setter
 * so Svelte's bind:value sees a normal input event.
 */
export function setInputValue(el: TextTarget, value: string) {
	const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
	Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value);
	el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Email and number inputs throw on selection access.
function selection(el: TextTarget): [number, number] {
	try {
		const start = el.selectionStart ?? el.value.length;
		return [start, el.selectionEnd ?? start];
	} catch {
		return [el.value.length, el.value.length];
	}
}

function setCaret(el: TextTarget, position: number) {
	try {
		el.setSelectionRange(position, position);
	} catch {
		// Not selectable, the caret stays at the end anyway.
	}
}

/** On-screen keyboard key press. Replaces any selection, like a real keystroke. */
export function insertText(el: TextTarget, text: string) {
	const [start, end] = selection(el);
	setInputValue(el, el.value.slice(0, start) + text + el.value.slice(end));
	setCaret(el, start + text.length);
}

function lastGraphemeLength(text: string): number {
	const last = [...new Intl.Segmenter().segment(text)].at(-1);
	return last?.segment.length ?? 1;
}

/**
 * On-screen keyboard backspace. Removes a whole grapheme, so a flag or a letter
 * with combining marks goes in one press.
 */
export function deleteBackward(el: TextTarget) {
	const [start, end] = selection(el);
	if (start === 0 && end === 0) return;
	const from = start === end ? start - lastGraphemeLength(el.value.slice(0, start)) : start;
	setInputValue(el, el.value.slice(0, from) + el.value.slice(end));
	setCaret(el, from);
}

/**
 * Enter from the phone or on-screen keyboard. Dispatches a real keydown first,
 * so a field that claims Enter itself can preventDefault the form submit.
 */
export function submitInput(el: TextTarget) {
	const event = new KeyboardEvent('keydown', {
		key: 'Enter',
		code: 'Enter',
		bubbles: true,
		cancelable: true
	});
	el.dispatchEvent(event);
	if (!event.defaultPrevented) el.closest('form')?.requestSubmit();
}

/** Lets TextField fire its onEnter only for single line fields, a textarea keeps Enter for newlines. */
export function isSingleLineEnter(event: KeyboardEvent, multiline: boolean): boolean {
	return event.key === 'Enter' && !multiline;
}

/** TextField listens for this to end editing, since the phone has no Escape key to send. */
export const TEXT_EXIT_EVENT = 'pivi-text-exit';

/** Used by RemoteBridge and the on-screen keyboard to close an editing TextField. */
export function requestTextExit(el: TextTarget) {
	el.dispatchEvent(new CustomEvent(TEXT_EXIT_EVENT, { bubbles: true }));
}

/** What the phone sent and when, so remoteController can recognize the TV echoing it back. */
export type SentText = { value: string; at: number };

// Long enough for the TV's state push to come back, short enough that an
// edit made on the TV later is not mistaken for an echo.
const ECHO_WINDOW_MS = 2000;

/** Adds what the phone just sent and drops entries too old to be echoes. */
export function recordSent(sent: SentText[], value: string, now: number): SentText[] {
	return [...sent.filter((s) => now - s.at < ECHO_WINDOW_MS), { value, at: now }];
}

/**
 * The phone's copy of a field after the TV reports its value. Keeps what the
 * phone has when the TV is only echoing something it sent a moment ago, so a
 * late echo does not overwrite newer typing.
 */
export function mirroredText(
	state: { hasTextInput: boolean; textValue: string },
	current: string,
	sent: SentText[],
	now: number
): string {
	const echo = sent.some((s) => s.value === state.textValue && now - s.at < ECHO_WINDOW_MS);
	const stale = !state.hasTextInput || state.textValue === current || echo;
	return stale ? current : state.textValue;
}
