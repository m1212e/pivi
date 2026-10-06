const CONTROLS_IDLE_MS = 3000;
const ACTIVITY_EVENTS = ['click', 'keydown', 'mousemove', 'touchstart'] as const;

/**
 * Hides the player controls after a stretch of inactivity, but only while
 * playing. Paused keeps them up. Must be created during component init.
 *
 * `focusTarget` is where focus moves before hiding. Once the old target is
 * disabled the browser resets focus to <body> and its focusin would re-show
 * the controls.
 */
export function createControlsVisibility(deps: {
	getPlaying: () => boolean;
	getFocusTarget: () => HTMLElement | undefined;
}) {
	let visible = $state(true);
	let idleTimeout: ReturnType<typeof setTimeout> | undefined;
	// Ignore the focusin from hide()'s own focus() call.
	let suppressNextFocusActivity = false;

	function hide() {
		visible = false;
		suppressNextFocusActivity = true;
		deps.getFocusTarget()?.focus();
	}

	function show() {
		visible = true;
		clearTimeout(idleTimeout);
		if (deps.getPlaying()) idleTimeout = setTimeout(hide, CONTROLS_IDLE_MS);
	}

	// Reads `playing` so the countdown re-arms or cancels as playback starts and stops.
	$effect(show);

	// Document level so remote driven focus and clicks count as activity too.
	$effect(() => {
		function onFocusIn() {
			if (suppressNextFocusActivity) {
				suppressNextFocusActivity = false;
				return;
			}
			show();
		}
		for (const event of ACTIVITY_EVENTS) document.addEventListener(event, show);
		document.addEventListener('focusin', onFocusIn);

		return () => {
			clearTimeout(idleTimeout);
			for (const event of ACTIVITY_EVENTS) document.removeEventListener(event, show);
			document.removeEventListener('focusin', onFocusIn);
		};
	});

	return {
		get visible() {
			return visible;
		},
		/** While hidden, everything but play/pause is out of reach so a stray swipe can't trigger something unseen. */
		get locked() {
			return !visible;
		}
	};
}
