// Pure decisions behind the on-screen keyboard, kept apart from the component
// so each stays small and testable.
import { isTextualInput, type TextTarget } from '#lib/textEntry';
import { composeDead, DEAD_SPACING, type Cell, type DeadKind } from './eurkey';

/** Sticky modifier state, since a remote can't hold shift while pressing another key. */
export type Modifier = 'off' | 'once' | 'lock';

const NEXT_MODIFIER: Record<Modifier, Modifier> = { off: 'once', once: 'lock', lock: 'off' };

/** Tap arms for one key, tap again locks, a third tap clears. */
export function cycleModifier(mod: Modifier): Modifier {
	return NEXT_MODIFIER[mod];
}

/** `text` is what to type, null when the press only arms an accent. */
export type CellPress = { text: string | null; dead: DeadKind | null };

function pressLetter(dead: DeadKind | null, letter: string): CellPress {
	return { text: dead ? composeDead(dead, letter) : letter, dead: null };
}

// A second accent prints the first one bare, and the same accent twice is how
// a real dead key types the accent itself.
function pressAccent(dead: DeadKind | null, accent: DeadKind): CellPress {
	if (!dead) return { text: null, dead: accent };
	return { text: DEAD_SPACING[dead], dead: dead === accent ? null : accent };
}

/** What pressing a key does given a pending accent, so the component only applies the result. */
export function pressCellResult(dead: DeadKind | null, cell: Cell): CellPress {
	return typeof cell === 'string' ? pressLetter(dead, cell) : pressAccent(dead, cell.dead);
}

/** What a hardware keyboard key means while the on-screen keys have focus. */
export type PhysicalKeyAction = 'dismiss' | 'backspace' | 'type';

/** Lets a real keyboard keep typing into the field while focus sits on the on-screen keys. Null to ignore the key. */
export function physicalKeyAction(event: KeyboardEvent): PhysicalKeyAction | null {
	if (event.key === 'Escape') return 'dismiss';
	if (event.key === 'Backspace') return 'backspace';
	return isPrintable(event) ? 'type' : null;
}

function isPrintable(event: KeyboardEvent): boolean {
	return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey;
}

/** Opens the keyboard for a newly focused field, unless the user just closed it on that same field. */
export function resolveFocus(
	el: Element,
	dismissed: TextTarget | null
): { target: TextTarget | null; dismissed: TextTarget | null } {
	if (isTextualInput(el) && el !== dismissed) return { target: el, dismissed };
	return { target: null, dismissed: el === dismissed ? dismissed : null };
}

function holdsFocus(target: TextTarget, active: Element | null, root: Element | undefined) {
	return active === target || root?.contains(active) === true;
}

/** Tells the keyboard to close once focus falls to <body>, e.g. after a click on empty space. */
export function focusWasDropped(
	target: TextTarget | null,
	active: Element | null,
	root: Element | undefined
): boolean {
	if (!target || holdsFocus(target, active, root)) return false;
	return !active || active === document.body;
}

/** For when the keys hide while focused, e.g. the phone keyboard takes over, so focus doesn't end up nowhere. */
export function reclaimFocus(target: TextTarget | null) {
	if (!target?.isConnected) return;
	if (document.activeElement === document.body) target.focus();
}
