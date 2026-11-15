// Turns the runtime's per-layer pull events into the one number the user cares
// about: how much of the app has arrived. Kept apart from microsandbox.ts so it
// can be tested without a VM.
import type { PullProgress } from './types';

/** The fields of a microsandbox pull event this reads (NapiPullProgressEvent). */
export type RawPullEvent = {
	kind: string;
	layerIndex?: number;
	layerCount?: number;
	totalDownloadBytes?: number | null;
	downloadedBytes?: number;
	totalBytes?: number | null;
};

/**
 * Feed it every event in order; it returns the progress to show after each one,
 * or undefined when the event changes nothing worth showing.
 */
export function pullProgressTracker() {
	let layerCount: number | undefined;
	let totalFromManifest: number | null = null;
	const downloaded = new Map<number, number>();
	const layerTotals = new Map<number, number>();
	const complete = new Set<number>();
	let phase: PullProgress['phase'] = 'resolving';

	const totalBytes = (): number | null => {
		if (totalFromManifest !== null) return totalFromManifest;
		// Without a total in the manifest, the layers' own sizes add up to one
		// once every layer has reported its size.
		if (layerCount === undefined || layerTotals.size < layerCount) return null;
		let sum = 0;
		for (const size of layerTotals.values()) sum += size;
		return sum;
	};

	const snapshot = (): PullProgress => {
		let sum = 0;
		for (const bytes of downloaded.values()) sum += bytes;
		const total = totalBytes();
		return {
			phase,
			downloadedBytes: total === null ? sum : Math.min(sum, total),
			totalBytes: total
		};
	};

	// One handler per event kind, each returning whether the event changed
	// anything worth showing.
	const onResolved = (event: RawPullEvent) => {
		layerCount = event.layerCount;
		totalFromManifest = event.totalDownloadBytes ?? null;
		phase = 'downloading';
		return true;
	};
	const onLayerProgress = (event: RawPullEvent) => {
		const layer = event.layerIndex ?? -1;
		if (phase === 'resolving') phase = 'downloading';
		downloaded.set(layer, event.downloadedBytes ?? 0);
		if (event.totalBytes != null) layerTotals.set(layer, event.totalBytes);
		return true;
	};
	const onLayerComplete = (event: RawPullEvent) => {
		const layer = event.layerIndex ?? -1;
		const bytes = event.downloadedBytes;
		downloaded.set(layer, bytes ?? downloaded.get(layer) ?? 0);
		layerTotals.set(layer, bytes ?? layerTotals.get(layer) ?? 0);
		complete.add(layer);
		// Layers unpack while others still download, so it only counts as
		// unpacking once nothing is left to fetch.
		if (layerCount !== undefined && complete.size >= layerCount) phase = 'unpacking';
		return true;
	};
	const onUnpacking = () => {
		if (phase === 'unpacking') return false;
		phase = 'unpacking';
		return true;
	};
	const handlers: Record<string, (event: RawPullEvent) => boolean> = {
		resolved: onResolved,
		layerDownloadProgress: onLayerProgress,
		layerDownloadComplete: onLayerComplete,
		stitchMergingTrees: onUnpacking,
		stitchWritingFsmeta: onUnpacking,
		stitchWritingVmdk: onUnpacking,
		stitchComplete: onUnpacking,
		complete: onUnpacking
	};

	return (event: RawPullEvent): PullProgress | undefined => {
		const handle = Object.hasOwn(handlers, event.kind) ? handlers[event.kind] : undefined;
		return handle?.(event) ? snapshot() : undefined;
	};
}
