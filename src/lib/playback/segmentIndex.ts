import type { SegmentBaseIndex } from '#lib/mse/dualTrackPlayer';
import type { MseQualityMeta, QualityOption } from './quality';
import type { SessionUrls } from './urls';

// 404 means no sidx or Cues index, so MSE can't work and the caller falls back to ffmpeg.
async function fetchSegmentIndex(url: string): Promise<SegmentBaseIndex> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Could not locate segment index (${res.status})`);
	return res.json();
}

/**
 * Shared by the engine's MSE setup and the quality catalog's probe, so both
 * agree on what counts as usable. Rejects when either track lacks an index.
 */
export async function fetchTrackIndexes(
	urls: SessionUrls,
	meta: MseQualityMeta,
	quality: QualityOption | undefined
): Promise<{ videoIndex: SegmentBaseIndex; audioIndex: SegmentBaseIndex }> {
	const [videoIndex, audioIndex] = await Promise.all([
		fetchSegmentIndex(urls.trackIndex('video', meta.videoContainer, quality)),
		fetchSegmentIndex(urls.trackIndex('audio', meta.audioContainer, quality))
	]);
	return { videoIndex, audioIndex };
}
