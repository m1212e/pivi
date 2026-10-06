// Turns raw touches into the press, release, cancel and move commands the TV
// understands. A press goes out immediately, before it is known whether the
// touch settles into a tap or turns into a swipe, so every press the TV sees
// is always followed by exactly one release or cancel.

/** Finger travel before a press becomes a swipe, so a slightly shaky tap still selects. */
export const MOVE_THRESHOLD = 48;

/** What TrackpadTab.svelte wires to the remote controller's trackpad commands. */
export type TrackpadActions = {
	press: () => void;
	release: () => void;
	/** Ends a press that never became a selection, so the TV doesn't click what is focused. */
	cancel: () => void;
	move: (dx: number, dy: number) => void;
};

// Screen coordinates of a touch.
type Point = { x: number; y: number };

/**
 * Gesture logic for TrackpadTab.svelte, kept apart from its touch event
 * plumbing. One instance per touch surface.
 */
export function createTrackpadGestures(actions: TrackpadActions) {
	let origin: Point | null = null;
	let moved = false;

	function reset() {
		origin = null;
		moved = false;
	}

	return {
		start(point: Point) {
			origin = point;
			moved = false;
			actions.press();
		},
		move(point: Point) {
			if (!origin) return;
			const dx = point.x - origin.x;
			const dy = point.y - origin.y;
			if (Math.max(Math.abs(dx), Math.abs(dy)) <= MOVE_THRESHOLD) return;
			// The first swipe step is when the phantom press gets cancelled.
			if (!moved) actions.cancel();
			actions.move(dx, dy);
			// Each report is relative to the last one.
			origin = point;
			moved = true;
		},
		end() {
			if (!moved) actions.release();
			reset();
		},
		/** The OS interrupted the touch, which is never a real selection. */
		interrupt() {
			if (!moved) actions.cancel();
			reset();
		}
	};
}
