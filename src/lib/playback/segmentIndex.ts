import type { SegmentBaseIndex } from '#lib/mse/dualTrackPlayer';
import type { MseQualityMeta, QualityOption } from './quality';
import type { SessionUrls } from './urls';

// 404 means no sidx or Cues index, so MSE can't work and the caller falls back to ffmpeg.
async function fetchSegmentIndex(url: string): Promise<SegmentBaseIndex> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Could not locate segment index (${res.status})`);
	return res.json();
}

/** Rejects when either track has no usable index, which rules MSE out for this tier. */
export async function fetchTrackIndexes(
	urls: SessionUrls,
	meta: MseQualityMeta,
	quality: QualityOption
): Promise<{ videoIndex: SegmentBaseIndex; audioIndex: SegmentBaseIndex }> {
	const [videoIndex, audioIndex] = await Promise.all([
		fetchSegmentIndex(urls.trackIndex('video', meta.videoContainer, quality)),
		fetchSegmentIndex(urls.trackIndex('audio', meta.audioContainer, quality))
	]);
	return { videoIndex, audioIndex };
}
