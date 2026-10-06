import { bufferedAheadSeconds } from './time';

const POLL_MS = 500;

// Subset of shaka's Stats, avoids importing its types here.
export type ShakaStats = {
	estimatedBandwidth: number;
	streamBandwidth: number;
	bytesDownloaded: number;
	decodedFrames: number;
	droppedFrames: number;
	bufferingTime: number;
	stallsDetected: number;
};

export type Diagnostics = {
	resolution: string;
	readyState: number;
	networkState: number;
	bufferedAheadSeconds: number;
	shakaStats: ShakaStats | null;
};

const resolutionOf = (el: HTMLVideoElement | undefined) =>
	el ? `${el.videoWidth}×${el.videoHeight}` : '—';

const loadStatesOf = (el: HTMLVideoElement | undefined) =>
	el
		? { readyState: el.readyState, networkState: el.networkState }
		: { readyState: 0, networkState: 0 };

const bufferedAheadOf = (el: HTMLVideoElement | undefined) =>
	el ? bufferedAheadSeconds(el.buffered, el.currentTime) : 0;

/**
 * Element and Shaka internals for the diagnostics panel. None of it is
 * reactive, so it is polled, and only while the panel is open. Must be
 * created during component init.
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
		get snapshot() {
			return snapshot;
		},
		toggle: () => (open = !open)
	};
}
