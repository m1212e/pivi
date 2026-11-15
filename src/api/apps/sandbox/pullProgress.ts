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

	return (event: RawPullEvent): PullProgress | undefined => {
		const layer = event.layerIndex ?? -1;
		switch (event.kind) {
			case 'resolved':
				layerCount = event.layerCount;
				totalFromManifest = event.totalDownloadBytes ?? null;
				phase = 'downloading';
				break;
			case 'layerDownloadProgress':
				phase = phase === 'resolving' ? 'downloading' : phase;
				downloaded.set(layer, event.downloadedBytes ?? 0);
				if (event.totalBytes != null) layerTotals.set(layer, event.totalBytes);
				break;
			case 'layerDownloadComplete':
				downloaded.set(layer, event.downloadedBytes ?? downloaded.get(layer) ?? 0);
				layerTotals.set(layer, event.downloadedBytes ?? layerTotals.get(layer) ?? 0);
				complete.add(layer);
				// Layers unpack while others still download, so it only counts as
				// unpacking once nothing is left to fetch.
				if (layerCount !== undefined && complete.size >= layerCount) phase = 'unpacking';
				break;
			case 'stitchMergingTrees':
			case 'stitchWritingFsmeta':
			case 'stitchWritingVmdk':
			case 'stitchComplete':
			case 'complete':
				if (phase === 'unpacking') return undefined;
				phase = 'unpacking';
				break;
			default:
				return undefined;
		}
		return snapshot();
	};
}
