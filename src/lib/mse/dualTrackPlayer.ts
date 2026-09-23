// Feeds a <video> element from two independently-hosted adaptive streams
// (video-only + audio-only, each reached through the generic byte-range
// proxy at src/routes/api/stream-track) using Shaka Player rather than
// hand-rolling the MediaSource feed ourselves.
//
// A from-scratch attempt at this (fetching fixed-size byte windows and
// appendBuffer-ing them directly) failed consistently, cross-browser, with
// SourceBuffer 'error' events and MediaError code 4 (MEDIA_ERR_SRC_NOT_
// SUPPORTED). The reason: MSE requires a container's *complete*
// initialization segment (for ISOBMFF, the whole ftyp+moov) in the very
// first append before any media data can be parsed -- a fixed-size window
// has no awareness of box boundaries, so it can truncate that segment for
// any file whose moov doesn't happen to fit inside it. Real DASH clients
// don't have this problem because they fetch the initialization segment as
// its own delineated unit (or detect it progressively); reimplementing that
// correctly is genuine container-parsing work, not a chunk-size tuning
// problem. FreeTube and Invidious hit this exact issue for the exact same
// reason (YouTube's split video-only/audio-only streams) and both solve it
// by generating a small DASH manifest locally and handing it to a real DASH
// client -- FreeTube specifically uses Shaka Player. This does the same:
// generate a minimal on-demand-profile MPD describing the two already-
// resolved stream URLs as one video and one audio AdaptationSet, and let
// Shaka's own networking/demuxing layer do the byte-range fetching and
// segment handling correctly.
//
// Each Representation needs a SegmentBase/SegmentList/SegmentTemplate --
// Shaka's DASH parser (verifyRepresentation_) silently drops any
// Representation that has none of the three, which empties the whole
// AdaptationSet and surfaces as a confusing DASH_EMPTY_ADAPTATION_SET
// (category 4, code 4003) with no mention of the real cause.
//
// Using SegmentBase specifically (not a single whole-file SegmentList) is
// what actually makes buffering progressive: these adaptive YouTube files
// aren't plain progressive downloads, they're already DASH-ready containers
// with a real segment index baked in by the encoder (an ISOBMFF `sidx` box
// for mp4, a Matroska `Cues` element for webm -- see
// src/api/plugins/containerIndex.ts). Pointing `<SegmentBase indexRange>`
// at that existing index lets Shaka fetch and buffer real, independently-
// decodable chunks (a few seconds each) instead of downloading the entire
// track in one request before anything can play.

let shakaPromise: Promise<typeof import('shaka-player')> | undefined;
let polyfillsInstalled = false;

// Loaded lazily (not a static import) since this is a large, browser-only
// library -- importing it at module scope would pull it into the SSR
// bundle and execute its UMD wrapper server-side for no reason, given this
// whole module is only ever used from a client-side effect.
//
// `.default`, not the dynamic-import namespace object itself -- the
// package's own type declarations export the whole `shaka` namespace as a
// single default export (`export default shaka`), so that's where Player/
// polyfill/etc. actually live on the awaited value.
async function loadShaka() {
	if (!shakaPromise) shakaPromise = import('shaka-player');
	const shaka = (await shakaPromise).default;
	if (!polyfillsInstalled) {
		shaka.polyfill.installAll();
		polyfillsInstalled = true;
	}
	return shaka;
}

function xmlEscape(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Absolute, not relative -- a relative <BaseURL> would resolve against the
// manifest's own blob: URL (see buildManifestUrl), which doesn't have a
// normal path structure to resolve a relative reference against.
function toAbsoluteUrl(path: string): string {
	return new URL(path, location.origin).href;
}

// "start-end", both ends inclusive -- the same HTTP-Range-style format
// Shaka's own XML parser expects for both @indexRange and <Initialization
// range>.
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

// Mirrors src/api/plugins/containerIndex.ts's exported type -- duplicated
// (not imported) since that module does real Node byte-fetching/parsing and
// has no business being pulled into the browser bundle; only the shape
// needs to cross that boundary, via the segment-index endpoint's JSON.
export type ByteRange = [start: number, end: number];
export type SegmentBaseIndex = { initRange: ByteRange; indexRange: ByteRange };

export type DualTrackOptions = {
	videoUrl: string;
	audioUrl: string;
	// Separate per track, not one shared container -- video and audio for
	// the same session can (and often do) come as different container
	// families, e.g. an avc1/mp4 video paired with an opus/webm audio track.
	videoMimeType: string; // 'video/webm' or 'video/mp4'
	audioMimeType: string; // 'audio/webm' or 'audio/mp4'
	videoCodec: string; // e.g. 'vp09.00.50.08' or 'avc1.640028'
	audioCodec: string; // e.g. 'opus' or 'mp4a.40.2'
	videoIndex: SegmentBaseIndex;
	audioIndex: SegmentBaseIndex;
	duration: number;
};

export type DualTrackHandle = {
	seek(seconds: number): void;
	destroy(): Promise<void>;
	// Shaka's own real playback stats (bandwidth, dropped frames, buffering
	// time, ...) -- shown as-is in the diagnostics panel rather than mapped
	// into a bespoke shape, since it's already a well-defined, useful one.
	getStats(): unknown;
};

// Rejects if this browser can't play it at all (Shaka unsupported, or the
// manifest fails to load for this codec combination) -- callers should
// catch that and fall back to the ffmpeg-remuxed proxy (src/routes/api/
// stream) instead, which is the only path that's actually guaranteed to
// work everywhere.
export async function attachDualTrackSource(
	videoEl: HTMLVideoElement,
	opts: DualTrackOptions,
	// Fires for a genuine playback-time failure (not the initial load,
	// which the caller already awaits and can catch directly) -- there's no
	// seamless recovery from that once a player is already attached, so
	// this just reports the raw shaka.util.Error for the caller to show as
	// a playback error rather than it silently vanishing as an unhandled
	// event.
	onError: (err: unknown) => void = () => {},
	// Where to start -- passed straight to Shaka's own load() rather than a
	// separate post-attach seek, since Shaka already supports this directly.
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
		// blob: URLs have no extension for Shaka to guess the manifest type
		// from, so without this it falls back to a HEAD request against the
		// blob URL itself to sniff the content-type -- which browsers reject
		// outright (net::ERR_METHOD_NOT_SUPPORTED), surfacing as a DASH parse
		// failure (category 4, code 4003) instead of the real cause.
		await player.load(manifestUrl, startTime || undefined, 'application/dash+xml');
	} finally {
		// Shaka has already fetched and parsed the manifest itself by the
		// time load() resolves (or rejects) -- nothing re-reads this blob
		// afterward, only the real stream-track URLs it references.
		URL.revokeObjectURL(manifestUrl);
	}

	return {
		// A real file the CDN serves with Range support, the same as the
		// direct-redirect path -- an ordinary native seek, no reload needed;
		// Shaka's own buffering handles range-fetching around it.
		seek(seconds) {
			videoEl.currentTime = Math.max(0, Math.min(opts.duration, seconds));
		},
		destroy: () => player.destroy(),
		getStats: () => player.getStats()
	};
}
