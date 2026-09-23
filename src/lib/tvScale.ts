// Every TV-facing page (everything except /remote, which is read up close on
// the phone that pairs to it, not from across a room) is built entirely out
// of Tailwind's rem-based utilities against a 1920x1080 design baseline --
// scaling the root font-size is what makes literally every one of them grow
// or shrink together for whatever the actual screen size turns out to be,
// with no per-component work. `min()` of the width and height ratios (not
// just width) is what keeps this correct for non-16:9 windows too -- an
// ultrawide window wouldn't blow the UI up past what actually fits
// vertically.
const BASELINE_WIDTH = 1920;
const BASELINE_HEIGHT = 1080;
const BASE_FONT_SIZE = 16;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

function computeScale(): number {
	const scale = Math.min(window.innerWidth / BASELINE_WIDTH, window.innerHeight / BASELINE_HEIGHT);
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

let removeResizeListener: (() => void) | undefined;

export function applyTvScale() {
	const update = () => {
		document.documentElement.style.fontSize = `${BASE_FONT_SIZE * computeScale()}px`;
	};
	update();
	window.addEventListener('resize', update);
	removeResizeListener = () => window.removeEventListener('resize', update);
}

export function clearTvScale() {
	removeResizeListener?.();
	removeResizeListener = undefined;
	document.documentElement.style.fontSize = '';
}
