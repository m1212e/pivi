import { describe, expect, it } from 'vitest';
import { pullProgressTracker } from './pullProgress';

describe('pullProgressTracker', () => {
	it('sums the layers against the total the manifest gives', () => {
		const track = pullProgressTracker();
		expect(track({ kind: 'resolving' })).toBeUndefined();
		expect(track({ kind: 'resolved', layerCount: 2, totalDownloadBytes: 1000 })).toEqual({
			phase: 'downloading',
			downloadedBytes: 0,
			totalBytes: 1000
		});
		track({ kind: 'layerDownloadProgress', layerIndex: 0, downloadedBytes: 300 });
		expect(
			track({ kind: 'layerDownloadProgress', layerIndex: 1, downloadedBytes: 200 })
		).toMatchObject({ downloadedBytes: 500, totalBytes: 1000 });
		// A layer reporting again replaces its own count rather than adding to it.
		expect(
			track({ kind: 'layerDownloadProgress', layerIndex: 0, downloadedBytes: 400 })
		).toMatchObject({ downloadedBytes: 600 });
	});

	it('only counts as unpacking once every layer has arrived', () => {
		const track = pullProgressTracker();
		track({ kind: 'resolved', layerCount: 2, totalDownloadBytes: 100 });
		expect(
			track({ kind: 'layerDownloadComplete', layerIndex: 0, downloadedBytes: 60 })
		).toMatchObject({ phase: 'downloading' });
		expect(track({ kind: 'layerMaterializeStarted', layerIndex: 0 })).toBeUndefined();
		expect(track({ kind: 'layerDownloadComplete', layerIndex: 1, downloadedBytes: 40 })).toEqual({
			phase: 'unpacking',
			downloadedBytes: 100,
			totalBytes: 100
		});
	});

	it('adds up the layer sizes when the manifest has no total', () => {
		const track = pullProgressTracker();
		track({ kind: 'resolved', layerCount: 2, totalDownloadBytes: null });
		expect(
			track({ kind: 'layerDownloadProgress', layerIndex: 0, downloadedBytes: 5, totalBytes: 10 })
		).toMatchObject({ totalBytes: null, downloadedBytes: 5 });
		expect(
			track({ kind: 'layerDownloadProgress', layerIndex: 1, downloadedBytes: 1, totalBytes: 30 })
		).toMatchObject({ totalBytes: 40, downloadedBytes: 6 });
	});

	it('reports unpacking for an image that was already there', () => {
		const track = pullProgressTracker();
		expect(track({ kind: 'complete', layerCount: 1 })).toMatchObject({ phase: 'unpacking' });
	});
});
