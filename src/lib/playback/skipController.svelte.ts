import { SvelteSet } from 'svelte/reactivity';
import type { KeyValueStorage } from '../storage';
import { loadSkipActive, saveSkipActive } from './preferences';
import { nextSkipStep, skipTarget, type SkipSegment } from './skipSegments';

type Deps = {
	storage: KeyValueStorage | null;
	/** Fetched in the background, starting playback doesn't depend on it. */
	fetchSegments: () => Promise<SkipSegment[]>;
	getPosition: () => number;
	getPlaying: () => boolean;
	getBuffering: () => boolean;
	seek: (seconds: number) => void;
};

/**
 * Offers or applies skipping of marked sections such as intros. Must be
 * created during component init.
 */
export function createSkipController(deps: Deps) {
	let segments = $state<SkipSegment[]>([]);
	// Persisted so it doesn't need deciding per segment.
	let active = $state(loadSkipActive(deps.storage));
	let pending = $state<SkipSegment | null>(null);
	// Keyed by reference so scrubbing back into a segment doesn't bring it back.
	const decided = new SvelteSet<SkipSegment>();

	deps
		.fetchSegments()
		.then((result) => (segments = result))
		.catch(() => {});

	$effect(() => saveSkipActive(deps.storage, active));

	function resolve(segment: SkipSegment) {
		decided.add(segment);
		pending = null;
		const target = skipTarget(segment, active, deps.getPlaying());
		if (target !== null) deps.seek(target);
	}

	$effect(() => {
		const step = nextSkipStep({
			segments,
			decided,
			active: pending,
			position: deps.getPosition(),
			playing: deps.getPlaying(),
			buffering: deps.getBuffering()
		});
		if (step.kind === 'resolve') resolve(step.segment);
		else pending = step.segment;
	});

	return {
		/** The segment currently being offered, null when there is none. */
		get pending() {
			return pending;
		},
		get active() {
			return active;
		},
		toggleActive: () => (active = !active)
	};
}
