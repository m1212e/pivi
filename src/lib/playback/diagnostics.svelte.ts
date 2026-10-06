import { bufferedAheadSeconds } from './time';

const POLL_MS = 500;

/** The Shaka stats the diagnostics panel shows. A local subset so this file doesn't import shaka's types. */
export type ShakaStats = {
	estimatedBandwidth: number;
	streamBandwidth: number;
	bytesDownloaded: number;
	decodedFrames: number;
	droppedFrames: number;
	bufferingTime: number;
	stallsDetected: number;
};

/** One snapshot rendered by DiagnosticsPanel. */
export type Diagnostics = {
	resolution: string;
	readyState: number;
	networkState: number;
	bufferedAheadSeconds: number;
	shakaStats: ShakaStats | null;
};

// Placeholders keep the panel rendering before the element exists.
const resolutionOf = (el: HTMLVideoElement | undefined) =>
	el ? `${el.videoWidth}×${el.videoHeight}` : '—';

const loadStatesOf = (el: HTMLVideoElement | undefined) =>
	el
		? { readyState: el.readyState, networkState: el.networkState }
		: { readyState: 0, networkState: 0 };

const bufferedAheadOf = (el: HTMLVideoElement | undefined) =>
	el ? bufferedAheadSeconds(el.buffered, el.currentTime) : 0;

/**
 * Feeds the play page's diagnostics panel, so playback problems can be read
 * on the TV without a console. None of it is reactive, so it is polled while
 * the panel is open. Must be created during component init.
 */
export function createDiagnostics(deps: {
	getVideo: () => HTMLVideoElement | undefined;
	getShakaStats: () => unknown;
}) {
	let open = $state(false);
	let snapshot = $state<Diagnostics>({
		resolution: '—',
		readyState: 0,
		networkState: 0,
		bufferedAheadSeconds: 0,
		shakaStats: null
	});

	function refresh() {
		const el = deps.getVideo();
		snapshot = {
			resolution: resolutionOf(el),
			...loadStatesOf(el),
			bufferedAheadSeconds: bufferedAheadOf(el),
			shakaStats: (deps.getShakaStats() as ShakaStats | null) ?? null
		};
	}

	$effect(() => {
		if (!open) return;
		refresh();
		const interval = setInterval(refresh, POLL_MS);
		return () => clearInterval(interval);
	});

	return {
		get open() {
			return open;
		},
		set open(value: boolean) {
			open = value;
		},
		/** Last polled values, only fresh while the panel is open. */
		get snapshot() {
			return snapshot;
		},
		toggle: () => (open = !open)
	};
}
