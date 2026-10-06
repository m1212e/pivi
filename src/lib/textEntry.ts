// Shared by the phone relay (RemoteBridge) and the on-screen keyboard, so both
// edit a field the same way a real keystroke would.

export type TextTarget = HTMLInputElement | HTMLTextAreaElement;

const TEXTUAL_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password']);

// A checkbox or a range slider is focusable but has nothing to type into.
export function isTextualInput(el: Element | null): el is TextTarget {
	if (el instanceof HTMLTextAreaElement) return true;
	return el instanceof HTMLInputElement && TEXTUAL_INPUT_TYPES.has(el.type);
}

// Goes through the prototype setter so frameworks that track `value`
// (Svelte's bind:value included) see a normal input event.
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

export function insertText(el: TextTarget, text: string) {
	const [start, end] = selection(el);
	setInputValue(el, el.value.slice(0, start) + text + el.value.slice(end));
	setCaret(el, start + text.length);
}

function lastGraphemeLength(text: string): number {
	const last = [...new Intl.Segmenter().segment(text)].at(-1);
	return last?.segment.length ?? 1;
}

// Removes a whole grapheme, so a flag or a letter with combining marks goes
// in one press.
export function deleteBackward(el: TextTarget) {
	const [start, end] = selection(el);
	if (start === 0 && end === 0) return;
	const from = start === end ? start - lastGraphemeLength(el.value.slice(0, start)) : start;
	setInputValue(el, el.value.slice(0, from) + el.value.slice(end));
	setCaret(el, from);
}

// A real keydown first, so a field that claims Enter itself (a multi-step
// form) can preventDefault it, otherwise the enclosing form is submitted.
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

// A textarea keeps Enter for its own newline.
export function isSingleLineEnter(event: KeyboardEvent, multiline: boolean): boolean {
	return event.key === 'Enter' && !multiline;
}

/**
 * The phone's copy of a field after the TV reports its value. Keeps what the
 * phone has when it just sent that value itself, so a late echo does not
 * overwrite newer typing.
 */
export function mirroredText(
	state: { hasTextInput: boolean; textValue: string },
	current: string,
	recentlySent: string[]
): string {
	const stale =
		!state.hasTextInput || state.textValue === current || recentlySent.includes(state.textValue);
	return stale ? current : state.textValue;
}
