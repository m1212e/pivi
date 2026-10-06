// Turns raw touches into the press, release, cancel and move commands the TV
// understands. A press goes out immediately, before it is known whether the
// touch settles into a tap or turns into a swipe, so every press the TV sees
// is always followed by exactly one release or cancel.

/** How far a finger travels before a press counts as a swipe. */
export const MOVE_THRESHOLD = 48;

export type TrackpadActions = {
	press: () => void;
	release: () => void;
	/** Ends a press that never became a selection, so the TV doesn't click what is focused. */
	cancel: () => void;
	move: (dx: number, dy: number) => void;
};

type Point = { x: number; y: number };

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
