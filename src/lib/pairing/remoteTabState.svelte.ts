import { flushSync } from 'svelte';
import { readItem, writeItem, type KeyValueStorage } from '../storage';
import { requiredTabFor, type RemoteTab, type TabInputs } from './remoteTabs';

// Kept in localStorage (this phone's own, not synced anywhere) so reopening
// the remote lands back on whichever side of the toggle was last chosen,
// rather than always resetting to the TV's current requirement.
const OVERRIDE_STORAGE_KEY = 'pivi-remote-manual-override';

/**
 * Which tab the phone shows. Normally whatever the TV asks for, but stepping
 * onto the trackpad to use its swipe gestures means stepping off a PIN or
 * text field, so that choice is an override with a way back. Must be created
 * during component init.
 */
export function createRemoteTabState(deps: {
	storage: KeyValueStorage | null;
	getTv: () => TabInputs;
}) {
	let manualOverride = $state<'trackpad' | null>(
		readItem(deps.storage, OVERRIDE_STORAGE_KEY) === 'trackpad' ? 'trackpad' : null
	);

	const required = $derived(requiredTabFor(deps.getTv()));
	const tab = $derived<RemoteTab>(manualOverride ?? required);

	// What is actually rendered. Updated inside a View Transition, so the
	// trackpad and whichever tab it swaps with morph instead of snapping.
	// Browsers without one (Firefox and Safari at the time of writing) assign directly.
	// svelte-ignore state_referenced_locally
	let displayed = $state(tab);
	$effect(() => {
		const next = tab;
		if (!document.startViewTransition) {
			displayed = next;
			return;
		}
		document.startViewTransition(() => flushSync(() => (displayed = next)));
	});

	function toggleTrackpad() {
		manualOverride = tab === 'trackpad' ? null : 'trackpad';
		writeItem(deps.storage, OVERRIDE_STORAGE_KEY, manualOverride);
		navigator.vibrate?.(6);
	}

	return {
		get required() {
			return required;
		},
		get displayed() {
			return displayed;
		},
		/** What the toggle button would switch to: the trackpad, or back to the TV's input. */
		get toggleTarget(): RemoteTab {
			return tab === 'trackpad' ? required : 'trackpad';
		},
		/** With the trackpad chosen on purpose, the TV types with its own on-screen keyboard instead. */
		get phoneKeyboard() {
			return manualOverride !== 'trackpad';
		},
		toggleTrackpad
	};
}
