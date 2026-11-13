// The engine's MSE path. Plays split streams (video only plus audio only, both
// through the byte range proxy at src/routes/api/stream-track) in one <video>
// without remuxing, which is what makes high tiers playable at all.
//
// Hand feeding MediaSource with fixed byte windows failed in every browser,
// since the first append must hold the whole init segment. Like FreeTube, this
// builds a minimal on-demand DASH manifest locally and lets Shaka fetch.
//
// Each Representation needs a SegmentBase, or Shaka silently drops it and
// reports DASH_EMPTY_ADAPTATION_SET (4003). Its indexRange points at the
// encoder's sidx or Cues index (see src/api/apps/containerIndex.ts), so Shaka
// buffers small chunks instead of the whole track.

let shakaPromise: Promise<typeof import('shaka-player')> | undefined;
let polyfillsInstalled = false;

// Lazy because Shaka is large and browser only, a static import would pull it
// into the SSR bundle. `.default` because the package's types export the whole `shaka` namespace
// as a single default export, so Player and polyfill live there.
async function loadShaka() {
	if (!shakaPromise) shakaPromise = import('shaka-player');
	const shaka = (await shakaPromise).default;
	if (!polyfillsInstalled) {
		shaka.polyfill.installAll();
		polyfillsInstalled = true;
	}
	return shaka;
}

// Codec strings and URLs end up inside XML attributes.
function xmlEscape(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Absolute because a relative <BaseURL> would resolve against the manifest's
// own blob: URL (see buildManifestUrl), which has no normal path to resolve against.
function toAbsoluteUrl(path: string): string {
	return new URL(path, location.origin).href;
}

// "start-end", both ends inclusive. That is the format Shaka's parser expects
// for both @indexRange and <Initialization range>.
function rangeAttr([start, end]: ByteRange): string {
	return `${start}-${end}`;
}

function representationXml(
	id: string,
	url: string,
	bandwidth: number,
	codecs: string,
	index: SegmentBaseIndex
): string {
	return `<Representation id="${id}" bandwidth="${bandwidth}" codecs="${xmlEscape(codecs)}">
	<BaseURL>${xmlEscape(toAbsoluteUrl(url))}</BaseURL>
	<SegmentBase indexRange="${rangeAttr(index.indexRange)}">
		<Initialization range="${rangeAttr(index.initRange)}" />
	</SegmentBase>
</Representation>`;
}

// Returns a blob: URL the caller must revoke. The bandwidths are rough guesses,
// there is a single Representation per track so Shaka has nothing to switch between.
function buildManifestUrl(opts: DualTrackOptions): string {
	const mpd = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${opts.duration}S" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
	<Period>
		<AdaptationSet mimeType="${opts.videoMimeType}" segmentAlignment="true">
			${representationXml('video', opts.videoUrl, 4000000, opts.videoCodec, opts.videoIndex)}
		</AdaptationSet>
		<AdaptationSet mimeType="${opts.audioMimeType}">
			${representationXml('audio', opts.audioUrl, 128000, opts.audioCodec, opts.audioIndex)}
		</AdaptationSet>
	</Period>
</MPD>`;
	return URL.createObjectURL(new Blob([mpd], { type: 'application/dash+xml' }));
}

// Mirrors src/api/apps/containerIndex.ts, which must stay out of the browser
// bundle. Only the shape crosses over, as the segment index endpoint's JSON.
export type ByteRange = [start: number, end: number];
export type SegmentBaseIndex = { initRange: ByteRange; indexRange: ByteRange };

/** What the engine knows about both tracks, enough to build the manifest. */
export type DualTrackOptions = {
	videoUrl: string;
	audioUrl: string;
	// Separate per track because video and audio of one session often come in
	// different containers, e.g. avc1/mp4 video with an opus/webm audio track.
	videoMimeType: string; // 'video/webm' or 'video/mp4'
	audioMimeType: string; // 'audio/webm' or 'audio/mp4'
	videoCodec: string; // e.g. 'vp09.00.50.08' or 'avc1.640028'
	audioCodec: string; // e.g. 'opus' or 'mp4a.40.2'
	videoIndex: SegmentBaseIndex;
	audioIndex: SegmentBaseIndex;
	duration: number;
};

/** Kept by the engine to seek, tear down on quality switch or fallback, and read stats. */
export type DualTrackHandle = {
	seek(seconds: number): void;
	destroy(): Promise<void>;
	// Shaka's raw stats, passed through as-is for the diagnostics panel.
	getStats(): unknown;
};

/**
 * Plays the two tracks in `videoEl` through Shaka. Rejects if this browser
 * can't play them (Shaka unsupported or the manifest fails for this codec
 * combination). Catch that and fall back to the ffmpeg remux proxy
 * (src/routes/api/stream), the only path guaranteed to work everywhere.
 */
export async function attachDualTrackSource(
	videoEl: HTMLVideoElement,
	opts: DualTrackOptions,
	// Fires for failures after the initial load, which the caller already
	// catches from the returned promise. There is no seamless recovery once a
	// player is attached, so the raw shaka.util.Error goes to the caller
	// instead of vanishing as an unhandled event.
	onError: (err: unknown) => void = () => {},
	// Passed to Shaka's load() so playback starts there, no seek after attach.
	startTime = 0
): Promise<DualTrackHandle> {
	const shaka = await loadShaka();
	if (!shaka.Player.isBrowserSupported()) {
		throw new Error('Shaka Player is not supported in this browser');
	}

	const player = new shaka.Player();
	player.addEventListener('error', ((event: CustomEvent) =>
		onError(event.detail)) as EventListener);
	await player.attach(videoEl);

	const manifestUrl = buildManifestUrl(opts);
	try {
		// blob: URLs have no extension to guess the manifest type from. Without
		// the explicit mime type Shaka sends a HEAD request to sniff it, which
		// browsers reject (net::ERR_METHOD_NOT_SUPPORTED) and which surfaces as
		// a DASH parse failure (category 4, code 4003) instead of the real cause.
		await player.load(manifestUrl, startTime || undefined, 'application/dash+xml');
	} finally {
		// Shaka has parsed the manifest by the time load() settles, nothing
		// re-reads the blob afterward.
		URL.revokeObjectURL(manifestUrl);
	}

	return {
		// The files are served with Range support, so a native seek is enough
		// and Shaka's buffering fetches around the new position.
		seek(seconds) {
			videoEl.currentTime = Math.max(0, Math.min(opts.duration, seconds));
		},
		destroy: () => player.destroy(),
		getStats: () => player.getStats()
	};
}
