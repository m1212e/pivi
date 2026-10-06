import { attachDualTrackSource, type DualTrackHandle } from '#lib/mse/dualTrackPlayer';
import { describeError } from './errors';
import {
	isMseCandidate,
	type MseQualityMeta,
	type QualityMeta,
	type QualityOption
} from './quality';
import { clampSeek, settleTimeUpdate, type SeekTarget } from './seek';
import { fetchTrackIndexes } from './segmentIndex';
import { mimeTypeFor, type SessionUrls } from './urls';

type Deps = {
	urls: SessionUrls;
	duration: number;
	getVideo: () => HTMLVideoElement | undefined;
	getQuality: () => QualityOption;
};

export type PlaybackMode = 'direct' | 'mse' | 'ffmpeg';

/**
 * Drives one <video> element through the three ways to play, best first.
 *
 * - direct: one URL, plain `<video src>`, native seeking.
 * - mse: separate tracks via Shaka over the range proxy, no remuxing.
 * - ffmpeg: live remux proxy. Works everywhere but slowest, so last resort.
 *
 * Owns everything derived from the element's clock (position, buffering,
 * seek bookkeeping). Must be created during component init.
 */
export function createPlayerEngine({ urls, duration, getVideo, getQuality }: Deps) {
	let mode = $state<PlaybackMode>('ffmpeg');
	let playing = $state(false);
	// True from the start, the first frame always has a gap.
	let buffering = $state(true);
	let currentTime = $state(0);
	// An ffmpeg seek reopens the stream at a new offset, so the element clock only counts from there.
	let seekOffset = $state(0);
	// Where the last seek should land, until playback gets there.
	// Without it the progress bar jumps after a scrub. The element reports the old
	// time for a moment and an ffmpeg reopen adds the offset twice.
	let seekTarget = $state<SeekTarget>(null);
	// Shown in the diagnostics panel so nobody has to dig through the console.
	let lastFallbackReason = $state<string | null>(null);
	// Set once ffmpeg, the last resort, reports an error.
	let failed = $state(false);

	let dualTrackHandle: DualTrackHandle | undefined;
	// Video and audio pumps can both fail at once. A second fallback would tear
	// down a SourceBuffer the first one is already discarding.
	let fallenBack = false;

	const position = $derived(seekOffset + currentTime);

	const streamUrlFor = (seconds: number) => urls.stream(seconds, getQuality());

	function destroyDualTrack() {
		dualTrackHandle?.destroy().catch(() => {});
		dualTrackHandle = undefined;
	}

	// Stop Shaka fetching after leaving the page.
	$effect(() => destroyDualTrack);

	/** Restarts ffmpeg's stream at `seconds` on a fresh element clock. */
	function reloadFfmpegStream(el: HTMLVideoElement, seconds: number) {
		buffering = true;
		seekOffset = seconds;
		// The new request starts at 0 on its own clock. Reset so position doesn't add the old elapsed time.
		currentTime = 0;
		el.src = streamUrlFor(seconds);
		el.load();
		el.play().catch(() => {});
	}

	function fallbackToFfmpeg(resumeSeconds: number, reason: string) {
		const el = getVideo();
		if (!el || fallenBack) return;
		fallenBack = true;
		lastFallbackReason = reason;
		console.error(`Falling back to remux proxy: ${reason}`);
		destroyDualTrack();
		mode = 'ffmpeg';
		reloadFfmpegStream(el, clampSeek(resumeSeconds, duration));
	}

	function setupDirectPlayback(el: HTMLVideoElement, resumeSeconds: number) {
		mode = 'direct';
		el.src = streamUrlFor(0);
		el.load();
		if (resumeSeconds > 0) {
			el.addEventListener('loadedmetadata', () => (el.currentTime = resumeSeconds), { once: true });
		}
		el.play().catch(() => {});
	}

	// Async because attaching Shaka loads a manifest.
	async function setupMsePlayback(
		el: HTMLVideoElement,
		meta: MseQualityMeta,
		resumeSeconds: number
	) {
		const quality = getQuality();
		try {
			const { videoIndex, audioIndex } = await fetchTrackIndexes(urls, meta, quality);
			dualTrackHandle = await attachDualTrackSource(
				el,
				{
					videoUrl: urls.track('video', quality),
					audioUrl: urls.track('audio', quality),
					videoMimeType: mimeTypeFor(meta.videoContainer, 'video'),
					audioMimeType: mimeTypeFor(meta.audioContainer, 'audio'),
					videoCodec: meta.vcodec,
					audioCodec: meta.acodec,
					videoIndex,
					audioIndex,
					duration
				},
				(err) => fallbackToFfmpeg(position, `MSE playback failed: ${describeError(err)}`),
				resumeSeconds
			);
			mode = 'mse';
			// Shaka doesn't autoplay on load.
			el.play().catch(() => {});
		} catch (err) {
			fallbackToFfmpeg(resumeSeconds, `MSE setup failed: ${describeError(err)}`);
		}
	}

	/**
	 * Starts playback from scratch on whatever stream `meta` describes. Also
	 * used for quality switches, which are a fresh setup on a different stream.
	 */
	async function setupPlayback(meta: QualityMeta, resumeSeconds: number) {
		const el = getVideo();
		if (!el) return;
		fallenBack = false;
		lastFallbackReason = null;
		destroyDualTrack();
		buffering = true;
		seekOffset = 0;
		// Show the resume point now, the old stream's time is stale.
		currentTime = resumeSeconds;
		seekTarget = null;

		if (meta.direct) {
			setupDirectPlayback(el, resumeSeconds);
		} else if (isMseCandidate(meta)) {
			await setupMsePlayback(el, meta, resumeSeconds);
		} else {
			fallbackToFfmpeg(resumeSeconds, 'no audio track resolved for this session');
		}
	}

	function seek(seconds: number) {
		const el = getVideo();
		if (!el || duration <= 0) return;
		const clamped = clampSeek(seconds, duration);
		const seekActions: Record<PlaybackMode, () => void> = {
			direct: () => (el.currentTime = clamped),
			mse: () => dualTrackHandle?.seek(clamped),
			ffmpeg: () => reloadFfmpegStream(el, clamped)
		};
		seekActions[mode]();
		// Show the target now and ignore stale updates, see seekTarget.
		// ffmpeg already moved position via its offset reset.
		seekTarget = { seconds: clamped, issuedAt: performance.now() };
		if (mode !== 'ffmpeg') currentTime = clamped - seekOffset;
	}

	function togglePlayPause() {
		const el = getVideo();
		if (!el) return;
		if (el.paused) el.play().catch(() => {});
		else el.pause();
	}

	function handleTimeUpdate() {
		const next = getVideo()?.currentTime ?? 0;
		const settled = settleTimeUpdate(seekTarget, seekOffset, next, performance.now());
		seekTarget = settled.target;
		if (settled.apply) currentTime = next;
	}

	// Direct and MSE failures fire this too, next to our own handling.
	// Showing the error screen would destroy the <video> mid fallback.
	// Only give up on ffmpeg, where nothing is left to fall back to.
	function handleMediaError() {
		if (mode === 'ffmpeg') {
			failed = true;
			return;
		}
		const mediaError = getVideo()?.error;
		fallbackToFfmpeg(
			position,
			mediaError
				? `native video error ${mediaError.code}: ${mediaError.message || '(no message)'}`
				: 'native video error (no detail available)'
		);
	}

	/** Spread onto the <video> so the engine sees the element's own state changes. */
	const videoEvents = {
		ontimeupdate: handleTimeUpdate,
		onplay: () => (playing = true),
		onpause: () => (playing = false),
		onwaiting: () => (buffering = true),
		onplaying: () => (buffering = false),
		oncanplay: () => (buffering = false),
		onerror: handleMediaError
	};

	return {
		get mode() {
			return mode;
		},
		get playing() {
			return playing;
		},
		get buffering() {
			return buffering;
		},
		get position() {
			return position;
		},
		get lastFallbackReason() {
			return lastFallbackReason;
		},
		get failed() {
			return failed;
		},
		videoEvents,
		setupPlayback,
		seek,
		seekBy: (deltaSeconds: number) => seek(position + deltaSeconds),
		togglePlayPause,
		/** Shaka's running stats, only available while playing through MSE. */
		getShakaStats: () => (mode === 'mse' ? (dualTrackHandle?.getStats() ?? null) : null)
	};
}

export type PlayerEngine = ReturnType<typeof createPlayerEngine>;
