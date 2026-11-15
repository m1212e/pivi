import type { UiNode } from '@pivi/sdk/ui';

type Container = Extract<UiNode, { type: 'container' }>;

// Applied in this order, each only when its flag is set. `self-start` on the
// sticky one keeps the stuck column at its own height instead of stretching
// to the full row, which would leave it nothing to stick within.
const OPTIONAL_CLASSES: [keyof Container, string][] = [
	['panel', 'rounded-3xl bg-white/8 px-12 py-10 ring-1 ring-white/12 backdrop-blur-md'],
	['sticky', 'sticky top-8 self-start'],
	['grow', 'min-w-0 flex-1'],
	['center', 'items-center text-center']
];

const JUSTIFY: Record<NonNullable<Container['justify']>, string> = {
	between: ' justify-between',
	around: ' justify-around'
};

// Flags are optional booleans on the node, so each maps to a class chunk.
function optionalClasses(n: Container): string {
	return OPTIONAL_CLASSES.filter(([flag]) => n[flag])
		.map(([, classes]) => ` ${classes}`)
		.join('');
}

// A centered column also fills most of the viewport so its content sits mid-screen.
// A sticky one with `justify` (a sidebar) spans the screen's height, so
// `between` puts its last child at the bottom. Sized for where it starts,
// below the app page's padding, title row and gap (src/routes/apps/[appId],
// 7.5rem) plus the bottom padding, so the bottom shows without scrolling.
// Stuck at the top later, it ends that much above the bottom edge.
function columnClasses(n: Container, extra: string): string {
	const base = n.center ? 'justify-center gap-8 min-h-[70vh]' : 'gap-3';
	const justify = n.justify && !n.center ? JUSTIFY[n.justify] : '';
	const fill = justify && n.sticky ? ' h-[calc(100vh-10rem)]' : '';
	return `flex flex-col ${base}${justify}${fill}${extra}`;
}

function rowClasses(n: Container, extra: string): string {
	const align = n.alignStart ? 'items-start' : 'items-center';
	return `flex flex-row ${align} gap-3${n.justify ? JUSTIFY[n.justify] : ''}${extra}`;
}

// A real grid, so rows of differently shaped cards (a round channel among
// videos) stay in the same columns, with the leftover width spread between
// them instead of piling up on the right.
const GRID =
	'grid grid-cols-[repeat(auto-fill,20rem)] items-start justify-between gap-x-4 gap-y-10 px-10';

/**
 * Turns a plugin screen's `container` flags into layout classes for
 * UiNodeRenderer, so apps get layout through data without ever sending CSS.
 * Layout only, anything with a look of its own is a component.
 */
export function containerRowClasses(n: Container): string {
	const extra = optionalClasses(n);
	if (n.direction !== 'row') return columnClasses(n, extra);
	return n.wrap ? `${GRID}${extra}` : rowClasses(n, extra);
}
