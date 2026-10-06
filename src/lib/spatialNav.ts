// Spatial navigation for the remote's swipes. Pure DOM geometry, no app state.

type Point = { x: number; y: number };
type Rank = { tier: number; score: number };

function centerOf(el: Element): Point {
	const rect = el.getBoundingClientRect();
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// A zero-length swipe (never sent in practice) would otherwise divide by zero
// and score every candidate NaN.
function unitVector(dx: number, dy: number): Point {
	const length = Math.hypot(dx, dy) || 1;
	return { x: dx / length, y: dy / length };
}

// A mostly-horizontal swipe stays inside the current shelf: the cone below is
// wide enough that the next row's cards can otherwise win over "nothing
// further right in this row", which reads as focus randomly hopping rows
// instead of stopping at the row's end.
function candidatesFor(els: HTMLElement[], active: HTMLElement, dx: number, dy: number) {
	const shelf = Math.abs(dx) > Math.abs(dy) ? active.closest('[data-pivi-hscroll]') : null;
	return els.filter((el) => el !== active && (!shelf || shelf.contains(el)));
}

// Distance and alignment of a candidate. `undefined` means it sits on top of
// where focus already is, or behind rather than ahead along the swipe.
function directionScore(
	from: Point,
	to: Point,
	dir: Point
): { distance: number; cos: number } | undefined {
	const vx = to.x - from.x;
	const vy = to.y - from.y;
	const distance = Math.hypot(vx, vy);
	const dot = vx * dir.x + vy * dir.y;
	if (distance === 0 || dot <= 0) return undefined;
	return { distance, cos: dot / distance };
}

// Whether a candidate sits in the lane the active element already occupies
// along the swipe's other axis. An in-lane candidate is a clean "next row",
// picked by pure along-axis distance with no angle limit. This lets a narrow
// row of small controls packed toward one side of a wide row still win over
// something full-width further away: its bounding box falls inside the wide
// row above it even though its center is well off to the side.
function inLane(activeRect: DOMRect, candidateRect: DOMRect, dx: number, dy: number): boolean {
	return Math.abs(dy) > Math.abs(dx)
		? candidateRect.left < activeRect.right && candidateRect.right > activeRect.left
		: candidateRect.top < activeRect.bottom && candidateRect.bottom > activeRect.top;
}

// Lower tier wins, then lower score. Candidates out of lane need to be within
// a ~60deg cone of the swipe, otherwise they belong to an unrelated row.
function rankOf(
	el: HTMLElement,
	ctx: { from: Point; activeRect: DOMRect; dir: Point; dx: number; dy: number }
): Rank | null {
	const result = directionScore(ctx.from, centerOf(el), ctx.dir);
	if (!result) return null;
	if (inLane(ctx.activeRect, el.getBoundingClientRect(), ctx.dx, ctx.dy)) {
		return { tier: 0, score: result.distance * result.cos };
	}
	return result.cos < 0.5 ? null : { tier: 1, score: result.distance / result.cos };
}

function isBetter(rank: Rank, other: Rank | undefined): boolean {
	return !other || (rank.tier - other.tier || rank.score - other.score) < 0;
}

function bestInDirection(els: HTMLElement[], active: HTMLElement, dx: number, dy: number) {
	const ctx = {
		from: centerOf(active),
		activeRect: active.getBoundingClientRect(),
		dir: unitVector(dx, dy),
		dx,
		dy
	};
	const ranked = candidatesFor(els, active, dx, dy).flatMap((el) => {
		const rank = rankOf(el, ctx);
		return rank ? [{ el, rank }] : [];
	});
	const best = ranked.reduce<(typeof ranked)[number] | undefined>(
		(top, entry) => (isBetter(entry.rank, top?.rank) ? entry : top),
		undefined
	);
	return best?.el ?? null;
}

function isMember(active: Element | null, els: HTMLElement[]): active is HTMLElement {
	return active instanceof HTMLElement && els.includes(active);
}

export type FocusMove = { el: HTMLElement; scroll: boolean };

/**
 * Picks where a swipe sends focus. With nothing focused (or focus somewhere
 * that is not a candidate, e.g. <body> after a navigation) the first
 * candidate takes it, so a swipe always gets focus onto the page. `scroll`
 * is set for real moves, which also bring the target into view.
 */
export function planMove(
	els: HTMLElement[],
	active: Element | null,
	dx: number,
	dy: number
): FocusMove | null {
	if (!isMember(active, els)) return els[0] ? { el: els[0], scroll: false } : null;
	const best = bestInDirection(els, active, dx, dy);
	return best ? { el: best, scroll: true } : null;
}
