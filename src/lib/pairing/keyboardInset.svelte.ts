import { onMount } from 'svelte';

// Below this the viewport change is browser chrome, not a keyboard.
const KEYBOARD_HEIGHT_THRESHOLD = 120;

/**
 * How many pixels the on-screen keyboard covers. visualViewport shrinks when
 * it opens, unlike window.innerHeight, and that gap lets the UI translate
 * itself up above the keyboard. Must be created during component init.
 */
export function createKeyboardInset() {
	let inset = $state(0);

	function update() {
		const vv = window.visualViewport;
		if (!vv) return;
		const diff = window.innerHeight - vv.height;
		inset = diff > KEYBOARD_HEIGHT_THRESHOLD ? diff : 0;
	}

	onMount(() => {
		window.visualViewport?.addEventListener('resize', update);
		update();
		return () => window.visualViewport?.removeEventListener('resize', update);
	});

	return {
		get value() {
			return inset;
		}
	};
}
