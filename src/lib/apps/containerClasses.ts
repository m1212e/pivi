import type { UiNode } from './ui';

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

const JUSTIFY: Record<string, string> = { between: ' justify-between', around: ' justify-around' };

function optionalClasses(n: Container): string {
	return OPTIONAL_CLASSES.filter(([flag]) => n[flag])
		.map(([, classes]) => ` ${classes}`)
		.join('');
}

function columnClasses(n: Container, extra: string): string {
	return `flex flex-col ${n.center ? 'justify-center gap-8 min-h-[70vh]' : 'gap-3'}${extra}`;
}

function rowClasses(n: Container, extra: string): string {
	const align = n.alignStart ? 'items-start' : 'items-center';
	return `flex flex-row ${align} gap-3${JUSTIFY[n.justify ?? ''] ?? ''}${extra}`;
}

// A real grid, so rows of differently shaped cards (a round channel among
// videos) stay in the same columns, with the leftover width spread between
// them instead of piling up on the right.
const GRID =
	'grid grid-cols-[repeat(auto-fill,20rem)] items-start justify-between gap-x-4 gap-y-10 px-10';

/**
 * Layout only: how a container arranges its children. Anything with a look
 * of its own is a component.
 */
export function containerRowClasses(n: Container): string {
	const extra = optionalClasses(n);
	if (n.direction !== 'row') return columnClasses(n, extra);
	return n.wrap ? `${GRID}${extra}` : rowClasses(n, extra);
}
