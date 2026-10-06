import { onMount } from 'svelte';

// Below this the viewport change is browser chrome, not a keyboard.
const KEYBOARD_HEIGHT_THRESHOLD = 120;

/**
 * Lets the phone remote page lift its controls above the on-screen keyboard,
 * which mobile browsers draw over the page instead of shrinking innerHeight.
 * Must be created during component init.
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
