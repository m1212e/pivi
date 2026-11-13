// TV pages are designed in rem against a 1920x1080 baseline, so scaling the
// root font-size fits the whole UI to any screen with no per-component work.
// The min of both ratios keeps non 16:9 windows from overflowing vertically.
const BASELINE_WIDTH = 1920;
const BASELINE_HEIGHT = 1080;
const BASE_FONT_SIZE = 16;
// Clamp so a tiny or huge window can't make the UI unreadable or absurdly large.
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

function computeScale(): number {
	const scale = Math.min(window.innerWidth / BASELINE_WIDTH, window.innerHeight / BASELINE_HEIGHT);
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

let removeResizeListener: (() => void) | undefined;

/** Called by the root layout on every TV page. Pair with clearTvScale. */
export function applyTvScale() {
	const update = () => {
		document.documentElement.style.fontSize = `${BASE_FONT_SIZE * computeScale()}px`;
	};
	update();
	window.addEventListener('resize', update);
	removeResizeListener = () => window.removeEventListener('resize', update);
}

/** The root layout calls this on /remote, which is read up close on the phone and keeps the default size. */
export function clearTvScale() {
	removeResizeListener?.();
	removeResizeListener = undefined;
	document.documentElement.style.fontSize = '';
}
