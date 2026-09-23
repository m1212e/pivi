<script lang="ts">
	import {
		ArrowLeft,
		Play,
		Pause,
		RotateCcw,
		RotateCw,
		Volume2,
		Gauge,
		LoaderCircle,
		Zap,
		Layers,
		Server,
		Info,
		Check
	} from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { client } from '#lib/api/rumbleClient/client';
	import Slider from '#lib/components/Slider.svelte';
	import {
		attachDualTrackSource,
		type DualTrackHandle,
		type SegmentBaseIndex
	} from '#lib/mse/dualTrackPlayer';

	const READY_STATE_LABELS = [
		'HAVE_NOTHING',
		'HAVE_METADATA',
		'HAVE_CURRENT_DATA',
		'HAVE_FUTURE_DATA',
		'HAVE_ENOUGH_DATA'
	];
	const NETWORK_STATE_LABELS = [
		'NETWORK_EMPTY',
		'NETWORK_IDLE',
		'NETWORK_LOADING',
		'NETWORK_NO_SOURCE'
	];

	const pluginId = page.params.pluginId!;
	const sessionId = page.params.sessionId!;
	const streamBaseUrl = `/api/stream/${encodeURIComponent(pluginId)}/${encodeURIComponent(sessionId)}`;

	function trackUrlFor(track: 'video' | 'audio', maxHeight: QualityOption = quality): string {
		const params = new URLSearchParams({ quality: String(maxHeight) });
		return `/api/stream-track/${encodeURIComponent(pluginId)}/${encodeURIComponent(sessionId)}/${track}?${params}`;
	}

	// `maxHeight` defaults to the currently-selected quality (every real
	// playback call site wants that), but takes an explicit tier too --
	// probeMse (below) needs to check other, not-yet-selected tiers, which
	// each land on their own `resolveStreamCached`/segment-index cache entry
	// (keyed by maxHeight), not the currently-playing one.
	function indexUrlFor(
		track: 'video' | 'audio',
		container: 'mp4' | 'webm',
		maxHeight: QualityOption = quality
	): string {
		const params = new URLSearchParams({ container, quality: String(maxHeight) });
		return `/api/stream-track/${encodeURIComponent(pluginId)}/${encodeURIComponent(sessionId)}/${track}/index?${params}`;
	}

	// VP9/AV1 video and Opus audio need a WebM SourceBuffer; H.264 video and
	// AAC audio need an MP4 one -- checked per track (not assumed to match
	// between video and audio) since the same session's two tracks can be,
	// and often are, different container families -- e.g. an avc1/mp4 video
	// paired with an opus/webm audio track. Feeding a SourceBuffer bytes in a
	// different container than its own codecs string declared is exactly
	// what breaks the demuxer.
	// The container each track is packaged in comes from the resolved stream
	// itself (see host.ts's Container type comment) rather than being
	// re-derived from the codec string here -- YouTube pairs vp9 with either
	// container depending on format, and av1 with mp4 despite webm supporting
	// it too, so guessing from vcodec/acodec alone gets it wrong in practice.
	function mimeTypeFor(container: 'mp4' | 'webm', kind: 'video' | 'audio'): string {
		return `${kind}/${container}`;
	}

	// The segment index endpoint (src/routes/api/stream-track/.../index)
	// locates the sidx/Cues index already baked into the resolved CDN file --
	// see src/api/plugins/containerIndex.ts for why that's there to find at
	// all. A 404 there (an mp4 with no sidx, a webm with no Cues) means this
	// session genuinely can't do real progressive MSE buffering, so this
	// throws and lets the caller fall back to the ffmpeg proxy rather than
	// attaching Shaka to a manifest that would just hang mid-download.
	async function fetchSegmentIndex(url: string): Promise<SegmentBaseIndex> {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Could not locate segment index (${res.status})`);
		return res.json();
	}

	// A height cap on the requested stream (see plugins/youtube/stream.ts) --
	// always resolving/remuxing the true "best" available quality (sometimes
	// 4K/8K) is more bitrate than a live remux-and-forward can reliably keep
	// up with, which is what made playback choppy -- there's deliberately no
	// "auto"/uncapped option for this reason (it also never adapted to
	// anything at runtime; it was just a one-shot "resolve the literal best"
	// pick, so it bought nothing a capped tier didn't already offer more
	// safely). 720p defaults here for a second reason too: it's one of the
	// handful of resolutions YouTube still serves as a single pre-muxed file,
	// which the streaming proxy hands the browser directly with no remux at
	// all (see its own comment) -- easily the biggest win for how long it
	// takes playback to actually start. The list below still lets the viewer
	// trade that startup speed for higher quality (or the other way, on a
	// slow network) themselves.
	const QUALITY_OPTIONS = [2160, 1440, 1080, 720, 480, 360] as const;
	type QualityOption = (typeof QUALITY_OPTIONS)[number];
	const DEFAULT_QUALITY = 720;
	let quality = $state<QualityOption>(DEFAULT_QUALITY);

	function streamUrlFor(seconds: number): string {
		const params = new URLSearchParams({ t: String(seconds), quality: String(quality) });
		return `${streamBaseUrl}?${params}`;
	}

	type QualityMeta = {
		direct: boolean;
		vcodec: string;
		acodec: string | null;
		videoContainer: 'mp4' | 'webm';
		audioContainer: 'mp4' | 'webm' | null;
	};

	// Metadata only (title, duration, codecs) -- never the raw stream URLs,
	// which stay entirely server-side. Fetched once up front rather than
	// kept live: unlike the dashboard's cards, nothing about a single
	// playback session's own title/duration changes while this page is open,
	// so this doesn't need to react to a later quality change on its own --
	// `maxHeight` here is only to land on the same cache entry the initial
	// playback setup (also DEFAULT_QUALITY) resolves. `direct`/codecs *do*
	// depend on quality (a lower cap is more likely to hit a pre-muxed
	// format), so qualityMeta below tracks them per option.
	const info = await client.liveQuery.pluginPlaybackInfo({
		__args: { pluginId, sessionId, maxHeight: DEFAULT_QUALITY },
		title: true,
		duration: true,
		direct: true,
		vcodec: true,
		acodec: true,
		videoContainer: true,
		audioContainer: true
	});

	// A plugin-provided skippable section (a SponsorBlock segment, for the
	// YouTube plugin) -- see #lib/plugins/host's SkipSegment for the
	// plugin-facing side of this same shape. Fetched in the background (not
	// a top-level await like `info` above) since nothing about starting
	// playback depends on it, and most sessions won't have any at all.
	type SkipSegment = { startSeconds: number; endSeconds: number; label: string };
	let skipSegments = $state<SkipSegment[]>([]);
	client.query
		.pluginSkipSegments({
			__args: { pluginId, sessionId },
			startSeconds: true,
			endSeconds: true,
			label: true
		})
		.then((result) => {
			skipSegments = result ?? [];
		})
		.catch(() => {});

	// Per quality tier: whether it's direct or proxied, and its codecs --
	// shown as a per-option icon in the quality list (below) rather than
	// just for whichever one happens to be selected, so the choice between
	// speed and resolution is visible up front instead of something you find
	// out by switching, and read again by selectQuality() to set up
	// playback for the new tier without a second round trip. `undefined`
	// means still resolving -- finding out requires the same per-plugin
	// resolution actually playing that quality would (there's no way to know
	// generically without asking), so this fires one request per remaining
	// option in the background rather than blocking on all of them before
	// the page can render.
	function toQualityMeta(result: {
		direct: boolean;
		vcodec: string;
		acodec: string | null;
		videoContainer: string;
		audioContainer: string | null;
	}): QualityMeta {
		return {
			direct: result.direct,
			vcodec: result.vcodec,
			acodec: result.acodec,
			// The server only ever reports these two containers (see host.ts's
			// Container schema) -- GraphQL just doesn't have an enum-of-string-
			// literals scalar to express that in the generated client type.
			videoContainer: result.videoContainer as 'mp4' | 'webm',
			audioContainer: result.audioContainer as 'mp4' | 'webm' | null
		};
	}

	// Whether a tier actually has a locatable sidx/Cues index -- `acodec`/
	// `audioContainer` alone can't tell you this (YouTube resolves an audio
	// track for essentially every tier, direct ones included), so unlike the
	// rest of qualityMeta, this can only be found out by actually asking the
	// segment-index endpoint the same question setupMsePlayback itself would.
	// `undefined` means not yet probed (or never a candidate -- direct/no-
	// audio tiers are never MSE candidates in the first place and are never
	// probed at all); the qualityButton snippet shows no icon for either of
	// those "don't know yet" cases, same as qualityMeta's own undefined.
	let mseAvailability = $state<Partial<Record<QualityOption, boolean>>>({});

	async function probeMse(option: QualityOption, meta: QualityMeta) {
		if (meta.direct || !meta.acodec || !meta.audioContainer) return;
		try {
			await Promise.all([
				fetchSegmentIndex(indexUrlFor('video', meta.videoContainer, option)),
				fetchSegmentIndex(indexUrlFor('audio', meta.audioContainer, option))
			]);
			mseAvailability = { ...mseAvailability, [option]: true };
		} catch {
			mseAvailability = { ...mseAvailability, [option]: false };
		}
	}

	let qualityMeta = $state<Partial<Record<QualityOption, QualityMeta>>>({
		[DEFAULT_QUALITY]: info ? toQualityMeta(info) : undefined
	});

	// The top-level `info` fetch above already resolved DEFAULT_QUALITY, so
	// this reuses it instead of firing a second, identical request for the
	// same tier.
	async function resolveQualityMeta(option: QualityOption): Promise<QualityMeta | undefined> {
		if (option === DEFAULT_QUALITY) return info ? toQualityMeta(info) : undefined;
		const result = await client.query
			.pluginPlaybackInfo({
				__args: { pluginId, sessionId, maxHeight: option },
				direct: true,
				vcodec: true,
				acodec: true,
				videoContainer: true,
				audioContainer: true
			})
			.catch(() => undefined);
		return result ? toQualityMeta(result) : undefined;
	}

	// Fired for every tier up front (not just the one that ends up selected)
	// so the quality list's own icons (see qualityButton) reflect real,
	// probed availability rather than a guess, same as before -- but now
	// also so the initial-playback pick below can wait for all of them to
	// settle and choose the actual best tier instead of just assuming
	// DEFAULT_QUALITY.
	const qualityResolutions = QUALITY_OPTIONS.map(async (option) => {
		const meta = await resolveQualityMeta(option);
		if (!meta) return;
		qualityMeta = { ...qualityMeta, [option]: meta };
		await probeMse(option, meta);
	});

	// Picks the highest resolution that's actually confirmed to support real
	// MSE playback (QUALITY_OPTIONS is already ordered highest to lowest)
	// once every tier has been probed -- falling back to the old
	// DEFAULT_QUALITY pick only if none of them do, so a session with no
	// MSE-capable tier at all still starts exactly like before.
	let readyForInitialAttach = $state(false);
	Promise.allSettled(qualityResolutions).then(() => {
		const bestMse = QUALITY_OPTIONS.find((option) => mseAvailability[option] === true);
		quality = bestMse ?? DEFAULT_QUALITY;
		readyForInitialAttach = true;
	});

	// A per-viewer convenience (this browser's own volume preference, not
	// anything shared/durable), so localStorage is the right place for it
	// rather than anything server-side. Guarded with SvelteKit's own
	// `browser` check (this file's top-level await also runs during SSR) --
	// not a try/catch, since some runtimes (Bun included) stub a
	// `localStorage` global server-side that warns instead of throwing,
	// so a throw-based guard wouldn't actually catch it. Still wrapped for
	// the separate case of private-browsing/storage-disabled contexts,
	// which really do throw.
	const VOLUME_STORAGE_KEY = 'pivi:player:volume';
	function loadStoredVolume(): number {
		if (!browser) return 1;
		try {
			const stored = Number(localStorage.getItem(VOLUME_STORAGE_KEY));
			return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 1;
		} catch {
			return 1;
		}
	}

	// Same idea as the volume preference above -- whether to actually act on
	// a plugin's skippable sections at all, remembered across sessions rather
	// than re-decided per segment. Defaults on: the whole point of the
	// feature is not having to react to every sponsor read individually, and
	// only the exact people who'd rather watch through them ever need to
	// touch this.
	const SKIP_ACTIVE_STORAGE_KEY = 'pivi:player:skipActive';
	function loadStoredSkipActive(): boolean {
		if (!browser) return true;
		try {
			const stored = localStorage.getItem(SKIP_ACTIVE_STORAGE_KEY);
			return stored === null ? true : stored === 'true';
		} catch {
			return true;
		}
	}

	let videoEl: HTMLVideoElement | undefined = $state();
	let playing = $state(false);
	let currentTime = $state(0);
	let volume = $state(loadStoredVolume());
	let errorMessage = $state<string | null>(null);
	// Starts true -- the stream only starts arriving once the browser opens
	// the request, so there's always a real buffering gap before the first
	// frame, not just on a seek/quality change. `waiting` fires whenever
	// playback stalls for lack of data (not just at start), `playing` and
	// `canplay` both mean there's enough buffered to actually show something.
	let buffering = $state(true);

	// A seek reopens the stream from a new server-side offset (see the
	// streaming proxy's own comment on why) rather than doing an in-place
	// `currentTime` seek -- so the video element's own `currentTime` only
	// ever measures "how far into *this* request are we," and the position
	// actually shown/reported has to add back whatever offset the last seek
	// started from.
	let seekOffset = $state(0);
	const position = $derived(seekOffset + currentTime);
	const duration = info?.duration ?? 0;
	const title = info?.title ?? '';
	// The progress slider's own displayed value -- tracks `position` while
	// idle, but takes over during an active drag/swipe (see Slider's
	// liveValue/onCommit props), so scrubbing shows where you're dragging
	// to, not where playback currently is.
	let scrubPosition = $state(0);

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	// Best-effort human-readable summary of whatever a failure handed us --
	// a SourceBuffer 'error' event carries no structured detail of its own
	// (the actual decode complaint goes to the browser's own console
	// independently), a thrown codec-support check is a plain Error, and a
	// native <video> error is a MediaError with a real code/message. Used to
	// fill in lastFallbackReason so the diagnostics panel has *something*
	// concrete rather than just "it failed."
	// A shaka.util.Error -- duck-typed rather than importing shaka's own types
	// here, since this file otherwise treats the library as opaque behind
	// #lib/mse/dualTrackPlayer.
	function isShakaError(
		err: unknown
	): err is { category: unknown; code: unknown; message: unknown } {
		if (!err || typeof err !== 'object') return false;
		return ['category', 'code', 'message'].every((key) => key in err);
	}

	function targetName(target: EventTarget | null): string {
		if (!target || !target.constructor) return 'unknown target';
		return target.constructor.name;
	}

	function describeVideoEvent(err: Event): string {
		const target = err.target;
		const mediaError = target instanceof HTMLVideoElement ? target.error : null;
		if (!mediaError) return `${err.type} event on ${targetName(target)}`;
		return `MediaError ${mediaError.code}: ${mediaError.message || '(no message)'}`;
	}

	// The shaka case is handled separately since it's a duck-typed shape
	// rather than an instanceof check like the rest.
	function describeNonShakaError(err: unknown): string {
		if (err instanceof DOMException) return `${err.name}: ${err.message}`;
		if (err instanceof Error) return err.message;
		if (err instanceof Event) return describeVideoEvent(err);
		return String(err);
	}

	function describeError(err: unknown): string {
		if (isShakaError(err)) {
			return `Shaka error (category ${err.category}, code ${err.code}): ${err.message}`;
		}
		return describeNonShakaError(err);
	}

	// Three ways this page actually gets bytes onto the screen, in order of
	// preference:
	// - 'direct': the resolved stream is already one self-contained URL (see
	//   src/routes/api/stream's own comment) -- a plain <video src>, the
	//   fastest and simplest path, with real native seeking.
	// - 'mse': separate video/audio tracks fed through two MediaSource
	//   SourceBuffers via #lib/mse/dualTrackPlayer, each pulled over HTTP
	//   Range through the byte-range proxy (src/routes/api/stream-track) --
	//   no server-side muxing at all, the browser buffers/decodes exactly
	//   like a real DASH player would.
	// - 'ffmpeg': falls back to the old live-remux proxy (src/routes/api/
	//   stream) when MSE isn't supported for this codec/browser at all, or a
	//   dual-track pump fails at runtime -- the one path guaranteed to work
	//   everywhere, at the cost of everything that made it worth replacing.
	let mode = $state<'direct' | 'mse' | 'ffmpeg'>('ffmpeg');
	let dualTrackHandle: DualTrackHandle | undefined;
	// A dual-track session's video and audio pumps can each independently
	// report a runtime failure (see attachDualTrackSource's onError) -- if
	// both fail around the same time, that's two calls to fallbackToFfmpeg
	// in quick succession. Without this guard, the second call would tear
	// down and reassign videoEl.src again right in the middle of the first
	// call's own reload, touching a SourceBuffer that first call had already
	// started discarding -- which is exactly what threw "not, or is no
	// longer, usable" instead of the fallback recovering cleanly.
	let fallenBack = false;
	// Whatever triggered the last fallback, in whichever detail is actually
	// available -- shown in the diagnostics panel below so this is visible
	// without needing to go dig through the console, and logged either way
	// so it's captured regardless of which of the two paths that can call
	// fallbackToFfmpeg (a labeled MSE track error, or the plain native
	// onerror below) ends up firing first.
	let lastFallbackReason = $state<string | null>(null);

	function fallbackToFfmpeg(resumeSeconds: number, reason: string) {
		if (!videoEl || fallenBack) return;
		fallenBack = true;
		lastFallbackReason = reason;
		console.error(`Falling back to remux proxy: ${reason}`);
		dualTrackHandle?.destroy().catch(() => {});
		dualTrackHandle = undefined;
		mode = 'ffmpeg';
		buffering = true;
		seekOffset = Math.max(0, Math.min(duration, resumeSeconds));
		videoEl.src = streamUrlFor(seekOffset);
		videoEl.load();
		videoEl.play().catch(() => {});
	}

	// (Re)attaches playback for a given quality tier's resolved metadata,
	// optionally resuming at a specific position -- used both for the
	// initial load and for a quality switch, which is otherwise exactly a
	// fresh setup against a different (possibly direct vs. proxied, possibly
	// differently-codec'd) resolved stream. Async because attaching Shaka
	// (attachDualTrackSource) genuinely is -- it fetches and parses a real
	// manifest before resolving -- so a failure there is a rejection to
	// catch, not a synchronous throw the way the old hand-rolled pump's
	// codec-support check was.
	function setupDirectPlayback(el: HTMLVideoElement, resumeSeconds: number) {
		mode = 'direct';
		el.src = streamUrlFor(0);
		el.load();
		if (resumeSeconds > 0) {
			el.addEventListener('loadedmetadata', () => (el.currentTime = resumeSeconds), { once: true });
		}
		el.play().catch(() => {});
	}

	async function setupMsePlayback(
		el: HTMLVideoElement,
		meta: QualityMeta & { acodec: string; audioContainer: 'mp4' | 'webm' },
		resumeSeconds: number
	) {
		try {
			const [videoIndex, audioIndex] = await Promise.all([
				fetchSegmentIndex(indexUrlFor('video', meta.videoContainer)),
				fetchSegmentIndex(indexUrlFor('audio', meta.audioContainer))
			]);
			dualTrackHandle = await attachDualTrackSource(
				el,
				{
					videoUrl: trackUrlFor('video'),
					audioUrl: trackUrlFor('audio'),
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
			// Unlike setupDirectPlayback/fallbackToFfmpeg's plain <video src>,
			// Shaka's player.load() never autoplays on its own -- without this,
			// the manifest loads and buffers but playback just sits paused
			// until the viewer manually hits play.
			el.play().catch(() => {});
		} catch (err) {
			fallbackToFfmpeg(resumeSeconds, `MSE setup failed: ${describeError(err)}`);
		}
	}

	async function setupPlayback(meta: QualityMeta, resumeSeconds: number) {
		if (!videoEl) return;
		fallenBack = false;
		lastFallbackReason = null;
		dualTrackHandle?.destroy().catch(() => {});
		dualTrackHandle = undefined;
		buffering = true;
		seekOffset = 0;

		if (meta.direct) {
			setupDirectPlayback(videoEl, resumeSeconds);
			return;
		}
		if (meta.acodec && meta.audioContainer) {
			await setupMsePlayback(
				videoEl,
				{ ...meta, acodec: meta.acodec, audioContainer: meta.audioContainer },
				resumeSeconds
			);
			return;
		}
		fallbackToFfmpeg(resumeSeconds, 'no audio track resolved for this session');
	}

	function reloadFfmpegStream(el: HTMLVideoElement, seconds: number) {
		buffering = true;
		seekOffset = seconds;
		el.src = streamUrlFor(seconds);
		el.load();
		el.play().catch(() => {});
	}

	function seek(seconds: number) {
		if (!videoEl || duration <= 0) return;
		const clamped = Math.max(0, Math.min(duration, seconds));
		const el = videoEl;
		// A real file the CDN serves with Range support gets an ordinary, exact,
		// native seek (no server round trip at all); mse hands it to Shaka.
		const seekActions: Record<typeof mode, () => void> = {
			direct: () => (el.currentTime = clamped),
			mse: () => dualTrackHandle?.seek(clamped),
			ffmpeg: () => reloadFfmpegStream(el, clamped)
		};
		seekActions[mode]();
	}

	function seekBy(deltaSeconds: number) {
		seek(position + deltaSeconds);
	}

	// Whether to actually act on the plugin's skippable sections at all --
	// persisted (see loadStoredSkipActive above), not a per-segment decision,
	// so toggling it once is remembered for every later segment/session
	// rather than having to react to each one individually.
	let skipActive = $state(loadStoredSkipActive());

	// How far ahead of a segment's own start to reveal the toggle -- there's
	// no countdown number shown (see the template), just enough lead time
	// for the checkbox to actually be reachable before the segment starts.
	const SKIP_LEAD_SECONDS = 3;
	let activeSkipSegment = $state<SkipSegment | null>(null);
	// Segments already resolved (skipped, or played through because
	// skipActive was off at the time) this session -- keyed by reference, not
	// time, so scrubbing back into one doesn't immediately reappear.
	const decidedSkipSegments = new SvelteSet<SkipSegment>();

	// Entirely driven by `position` (itself only advancing on real
	// `ontimeupdate` events, i.e. actual playback) -- shows the toggle once
	// position enters the lead window before an undecided segment, and
	// decides it the moment position reaches the segment's own start: skips
	// ahead if skipActive is on, or just lets the segment play if it's off.
	// No timer of its own, so pausing anywhere in the lead window genuinely
	// freezes it instead of a decision firing on schedule regardless of
	// whether anyone's watching.
	$effect(() => {
		if (activeSkipSegment) {
			if (position >= activeSkipSegment.startSeconds) {
				const segment = activeSkipSegment;
				decidedSkipSegments.add(segment);
				activeSkipSegment = null;
				if (skipActive && playing) seek(segment.endSeconds);
			}
			return;
		}
		activeSkipSegment =
			skipSegments.find(
				(segment) =>
					!decidedSkipSegments.has(segment) &&
					position >= segment.startSeconds - SKIP_LEAD_SECONDS &&
					position < segment.startSeconds
			) ?? null;
	});

	function togglePlayPause() {
		if (!videoEl) return;
		if (videoEl.paused) videoEl.play().catch(() => {});
		else videoEl.pause();
	}

	// One-way the other direction from `onvolumechange` below: that keeps
	// `volume` in sync when the element's volume changes on its own (e.g. a
	// fresh <video> defaulting to 1), this pushes a change made *through* the
	// slider back onto the element. Guarded so the two don't fight -- without
	// it, onvolumechange re-firing from this same assignment would re-run
	// this effect right back into another (no-op, but pointless) assignment.
	$effect(() => {
		if (videoEl && Math.abs(videoEl.volume - volume) > 0.001) videoEl.volume = volume;
	});

	// Remembered for next time -- otherwise every fresh playback session
	// starts back at full volume regardless of what was last set.
	$effect(() => {
		if (!browser) return;
		try {
			localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
		} catch {
			// Private browsing / storage disabled -- nothing to persist to.
		}
	});

	$effect(() => {
		if (!browser) return;
		try {
			localStorage.setItem(SKIP_ACTIVE_STORAGE_KEY, String(skipActive));
		} catch {
			// Private browsing / storage disabled -- nothing to persist to.
		}
	});

	// Sets up the very first playback once the <video> element exists *and*
	// the best-quality pick above has settled -- guarded so later, unrelated
	// qualityMeta updates (a manual selectQuality, say) don't re-trigger it;
	// this effect's only job is the one-time initial attach. Always
	// autoplays (setupPlayback's own paths all end in a real .play() call)
	// regardless of whether a previous visit to this session left off
	// paused -- there's no persisted play/pause state to honor in the first
	// place, so a fresh visit always starts playing from 0, same as before.
	let initialized = false;
	$effect(() => {
		if (videoEl && readyForInitialAttach && !initialized) {
			initialized = true;
			const meta = qualityMeta[quality];
			if (meta) setupPlayback(meta, 0);
		}
	});

	// Tears down the Shaka player when the page is left -- otherwise it'd
	// keep fetching after nobody's watching, the same class of bug the
	// streaming proxy's own cancel() handling exists to prevent.
	$effect(() => {
		return () => {
			dualTrackHandle?.destroy().catch(() => {});
		};
	});

	// A quality switch is a genuinely different resolved stream (possibly a
	// different mode entirely, not just a different bitrate), so it's
	// handled as a fresh setupPlayback rather than a plain seek/reload.
	// qualityMeta already has (or will shortly have) this option's metadata
	// from the background resolution above; only fetch it directly if
	// picked before that finished.
	function selectQuality(target: QualityOption) {
		if (target === quality) return;
		const resumeAt = position;
		quality = target;

		const meta = qualityMeta[target];
		if (meta) {
			setupPlayback(meta, resumeAt);
			return;
		}
		client.query
			.pluginPlaybackInfo({
				__args: { pluginId, sessionId, maxHeight: target },
				direct: true,
				vcodec: true,
				acodec: true,
				videoContainer: true,
				audioContainer: true
			})
			.then((result) => {
				if (!result) return;
				const resolvedMeta = toQualityMeta(result);
				qualityMeta = { ...qualityMeta, [target]: resolvedMeta };
				probeMse(target, resolvedMeta);
				if (quality === target) setupPlayback(resolvedMeta, resumeAt);
			})
			.catch(() => {});
	}

	function goBack() {
		history.back();
	}

	// Hidden (not unmounted -- see the template's own note on why) after a
	// stretch of no interaction, but only while actually playing; pausing
	// keeps it up indefinitely, same idea as the home page's own idle timer
	// (IDLE_TIMEOUT_MS there) but gated on playback state instead of always
	// running.
	let controlsVisible = $state(true);
	const CONTROLS_IDLE_MS = 3000;
	let idleTimeout: ReturnType<typeof setTimeout> | undefined;

	// Every control except play/pause is pulled out of both the remote's
	// focus/selection candidates and pointer/keyboard input entirely while
	// this holds (see the `disabled`/`inert` bindings below) -- so a stray
	// swipe or tap while the overlay isn't even visible can't land on (and
	// silently trigger) something the viewer never actually saw was there.
	// Always false while paused: showControls() below only ever sets
	// controlsVisible false while playing, and immediately re-shows the
	// moment playback pauses for any reason (the `playing`-reading effect
	// further down), so "locked" and "actually playing" can't drift apart.
	const locked = $derived(!controlsVisible);
	let playPauseButton = $state<HTMLButtonElement>();

	// Moving focus onto the play/pause button ourselves, synchronously, at
	// the exact moment we hide (rather than reactively off `locked`) is what
	// keeps this from racing the browser's own focus-reset behavior once
	// whatever was previously focused becomes `disabled` -- that reset can
	// land on `<body>` and fire its own focusin first, which would otherwise
	// re-show the controls we just decided to hide before our own call ever
	// runs. Doing it here moves focus away while the previous target is
	// still enabled, a perfectly normal focus change.
	function hideControls() {
		controlsVisible = false;
		suppressNextFocusActivity = true;
		playPauseButton?.focus();
	}

	function showControls() {
		controlsVisible = true;
		clearTimeout(idleTimeout);
		if (playing) idleTimeout = setTimeout(hideControls, CONTROLS_IDLE_MS);
	}

	// Reads `playing` synchronously, so this re-runs (re-arming or cancelling
	// the countdown) the moment playback actually starts/stops, not just on
	// the next unrelated interaction -- otherwise pressing Play wouldn't
	// start the countdown, and pausing wouldn't reliably cancel one already
	// in flight, until something else happened to trigger showControls.
	$effect(() => {
		showControls();
	});

	// hideControls()'s own focus() call is a real DOM focus change, which
	// the focusin listener below would otherwise treat as fresh activity and
	// immediately re-show what was just hidden -- this tells it to ignore
	// exactly that one, synthetic move.
	let suppressNextFocusActivity = false;

	// Document-level, not just this page's own root: a remote swipe/select
	// lands as a real focusin/click on whatever element it drove (see
	// RemoteBridge.svelte), so this reacts to remote-driven interaction the
	// same as a direct mouse/touch/keyboard one, with no extra wiring.
	$effect(() => {
		const activityEvents = ['click', 'keydown', 'mousemove', 'touchstart'] as const;
		for (const event of activityEvents) document.addEventListener(event, showControls);

		function onFocusIn() {
			if (suppressNextFocusActivity) {
				suppressNextFocusActivity = false;
				return;
			}
			showControls();
		}
		document.addEventListener('focusin', onFocusIn);

		return () => {
			clearTimeout(idleTimeout);
			for (const event of activityEvents) document.removeEventListener(event, showControls);
			document.removeEventListener('focusin', onFocusIn);
		};
	});

	// A subset of shaka.extern.Stats -- not imported from the library itself
	// (this file doesn't otherwise touch Shaka's types directly, since
	// attachDualTrackSource's own return type stays deliberately opaque
	// here), just the handful of fields worth surfacing in the panel below.
	type ShakaStats = {
		estimatedBandwidth: number;
		streamBandwidth: number;
		bytesDownloaded: number;
		decodedFrames: number;
		droppedFrames: number;
		bufferingTime: number;
		stallsDetected: number;
	};

	// A live snapshot of whatever's actually happening, for the info panel
	// below -- most of this (readyState, buffered ranges, Shaka's own
	// playback stats) isn't reactive on its own, so it's polled rather than
	// derived, and only while the panel's actually open.
	let diagnosticsOpen = $state(false);
	let diagnostics = $state({
		resolution: '—',
		readyState: 0,
		networkState: 0,
		bufferedAheadSeconds: 0,
		shakaStats: null as ShakaStats | null
	});

	function findBufferedRangeEnd(buffered: TimeRanges, currentTime: number): number | undefined {
		for (let i = 0; i < buffered.length; i++) {
			if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i))
				return buffered.end(i);
		}
		return undefined;
	}

	function bufferedAheadSecondsFor(el: HTMLVideoElement | undefined): number {
		if (!el) return 0;
		const rangeEnd = findBufferedRangeEnd(el.buffered, el.currentTime);
		return rangeEnd === undefined ? 0 : rangeEnd - el.currentTime;
	}

	function resolutionLabel(el: HTMLVideoElement | undefined): string {
		return el ? `${el.videoWidth}×${el.videoHeight}` : '—';
	}

	function readyStateOf(el: HTMLVideoElement | undefined): number {
		return el?.readyState ?? 0;
	}

	function networkStateOf(el: HTMLVideoElement | undefined): number {
		return el?.networkState ?? 0;
	}

	function currentShakaStats(): ShakaStats | null {
		if (mode !== 'mse') return null;
		return (dualTrackHandle?.getStats() as ShakaStats) ?? null;
	}

	function updateDiagnostics() {
		diagnostics = {
			resolution: resolutionLabel(videoEl),
			readyState: readyStateOf(videoEl),
			networkState: networkStateOf(videoEl),
			bufferedAheadSeconds: bufferedAheadSecondsFor(videoEl),
			shakaStats: currentShakaStats()
		};
	}

	$effect(() => {
		if (!diagnosticsOpen) return;
		updateDiagnostics();
		const interval = setInterval(updateDiagnostics, 500);
		return () => clearInterval(interval);
	});
</script>

<svelte:head><title>{title || 'Playing'}</title></svelte:head>

{#snippet errorScreen()}
	<div class="flex size-full flex-col items-center justify-center gap-3 text-white">
		<p class="text-lg font-medium">Playback failed</p>
		<p class="max-w-sm text-center text-sm text-white/60">{errorMessage}</p>
		<button
			type="button"
			onclick={goBack}
			class="mt-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-white/90 focus:outline-none"
		>
			Back
		</button>
	</div>
{/snippet}

{#snippet diagnosticsPanel()}
	<div
		class="mt-4 max-w-sm rounded-2xl bg-white/12 p-4 font-mono text-xs text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150"
	>
		<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
			<span class="text-white/50">mode</span>
			<span>{mode}</span>
			<span class="text-white/50">quality</span>
			<span>{quality}p</span>
			<span class="text-white/50">direct</span>
			<span>{String(qualityMeta[quality]?.direct ?? '—')}</span>
			<span class="text-white/50">vcodec</span>
			<span>{qualityMeta[quality]?.vcodec ?? '—'}</span>
			<span class="text-white/50">acodec</span>
			<span>{qualityMeta[quality]?.acodec ?? '—'}</span>
			<span class="text-white/50">resolution</span>
			<span>{diagnostics.resolution}</span>
			<span class="text-white/50">readyState</span>
			<span>{diagnostics.readyState} ({READY_STATE_LABELS[diagnostics.readyState]})</span>
			<span class="text-white/50">networkState</span>
			<span>{diagnostics.networkState} ({NETWORK_STATE_LABELS[diagnostics.networkState]})</span>
			<span class="text-white/50">buffered ahead</span>
			<span>{diagnostics.bufferedAheadSeconds.toFixed(1)}s</span>
			<span class="text-white/50">position</span>
			<span>{position.toFixed(1)} / {duration.toFixed(1)}</span>
			<span class="text-white/50">buffering</span>
			<span>{buffering}</span>
		</div>

		{#if lastFallbackReason}
			<div class="mt-3 border-t border-white/15 pt-3">
				<p class="text-white/50">last fallback reason</p>
				<p class="break-words text-amber-300">{lastFallbackReason}</p>
			</div>
		{/if}

		{#if mode === 'mse' && diagnostics.shakaStats}
			<div class="mt-3 border-t border-white/15 pt-3">
				<p class="mb-1 text-white/50">shaka player</p>
				<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					<span class="text-white/50">bandwidth (est.)</span>
					<span>{Math.round(diagnostics.shakaStats.estimatedBandwidth / 1000)} kbps</span>
					<span class="text-white/50">stream bandwidth</span>
					<span>{Math.round(diagnostics.shakaStats.streamBandwidth / 1000)} kbps</span>
					<span class="text-white/50">downloaded</span>
					<span>{(diagnostics.shakaStats.bytesDownloaded / 1_000_000).toFixed(2)} MB</span>
					<span class="text-white/50">decoded / dropped</span>
					<span>
						{diagnostics.shakaStats.decodedFrames} / {diagnostics.shakaStats.droppedFrames}
					</span>
					<span class="text-white/50">buffering time</span>
					<span>{diagnostics.shakaStats.bufferingTime.toFixed(1)}s</span>
					<span class="text-white/50">stalls</span>
					<span>{diagnostics.shakaStats.stallsDetected}</span>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<!-- Flows over the video like the rest of the app's chrome (see HeroBanner's
     own top/bottom scrims) rather than pushing it into a letterboxed area --
     these are real focusable buttons the phone remote's swipe-to-focus +
     tap-to-select navigation drives exactly like every other screen. Faded
     out (not unmounted -- opacity + pointer-events, see controlsVisible
     above) rather than removed while idle and playing, so a remote-driven
     focus/click can still reach them to bring the UI back; always shown
     while paused so paused playback doesn't leave the screen looking dead. -->
{#snippet topOverlay()}
	<div
		class="absolute inset-x-0 top-0 bg-linear-to-b from-slate-950/85 via-slate-950/20 to-transparent px-6 pt-6 pb-16 transition-opacity duration-300 sm:px-10 {controlsVisible
			? 'opacity-100'
			: 'pointer-events-none opacity-0'}"
	>
		<div class="flex items-center gap-4">
			<button
				type="button"
				onclick={goBack}
				disabled={locked}
				aria-label="Back"
				class="rounded-full bg-white/12 p-3 text-white shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
			>
				<ArrowLeft class="size-5" />
			</button>
			<h1 class="min-w-0 flex-1 truncate text-lg font-medium text-white sm:text-xl">{title}</h1>
			<button
				type="button"
				onclick={() => (diagnosticsOpen = !diagnosticsOpen)}
				disabled={locked}
				aria-label="Playback diagnostics"
				aria-pressed={diagnosticsOpen}
				class="rounded-full p-3 shadow-lg ring-1 shadow-black/20 backdrop-blur-2xl backdrop-saturate-150 transition focus:outline-none {diagnosticsOpen
					? 'bg-white text-slate-950'
					: 'bg-white/12 text-white ring-white/25 hover:bg-white/20'}"
			>
				<Info class="size-5" />
			</button>
		</div>

		{#if diagnosticsOpen}
			{@render diagnosticsPanel()}
		{/if}
	</div>
{/snippet}

{#snippet qualityButton(option: QualityOption)}
	{@const meta = qualityMeta[option]}
	<!-- Mirrors setupPlayback's own branching (direct / MSE / ffmpeg
	     fallback), but MSE specifically can't be predicted from meta alone --
	     acodec/audioContainer are present for nearly every tier regardless of
	     whether a locatable sidx/Cues index actually exists (see probeMse) --
	     so this reflects mseAvailability's real, probed answer instead of
	     just guessing "has an audio track" means MSE will actually work. -->
	{@const mode =
		meta &&
		(meta.direct
			? 'direct'
			: meta.acodec && meta.audioContainer
				? mseAvailability[option] === true
					? 'mse'
					: mseAvailability[option] === false
						? 'ffmpeg'
						: undefined
				: 'ffmpeg')}
	<button
		type="button"
		onclick={() => selectQuality(option)}
		disabled={locked}
		aria-pressed={quality === option}
		class="flex w-28 items-center justify-between gap-2 rounded-full px-3 py-2 text-xs font-medium transition focus:outline-none {quality ===
		option
			? 'bg-white text-slate-950 shadow-lg'
			: 'bg-white/12 text-white/70 ring-1 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 hover:bg-white/20'}"
	>
		<span>{option}p</span>
		{#if mode === 'direct'}
			<span title="Direct connection — streaming straight from the source">
				<Zap class="size-4 {quality === option ? 'text-emerald-600' : 'text-emerald-400'}" />
			</span>
		{:else if mode === 'mse'}
			<span
				title="Adaptive streaming — video and audio buffered separately in the browser, no server-side remuxing"
			>
				<Layers class="size-4 {quality === option ? 'text-sky-600' : 'text-sky-400'}" />
			</span>
		{:else if mode === 'ffmpeg'}
			<span title="Proxied — being relayed and remuxed through this server">
				<Server class="size-4 {quality === option ? 'text-amber-600' : 'text-amber-400'}" />
			</span>
		{/if}
	</button>
{/snippet}

<!-- Deliberately the one control on this whole page that's NOT
     `disabled={locked}` and NOT nested inside bottomOverlay's fading
     container -- a skippable section is approaching regardless of whether
     the rest of the UI happens to be on screen, so unlike every other
     control here, this one has to stay both visible and genuinely
     selectable (not just synthetically click-through-focus like play/pause)
     the whole time. Positioned to land in the gap between the quality list
     and the playback-controls group in bottomOverlay's own row below --
     approximated with fixed offsets rather than measured, since it has to
     hold that position on its own even while that row is faded out. -->
{#snippet skipSegmentBanner()}
	{#if activeSkipSegment}
		<div class="absolute right-40 bottom-16 z-10 sm:right-48 sm:bottom-20">
			<button
				type="button"
				onclick={() => (skipActive = !skipActive)}
				role="checkbox"
				aria-checked={skipActive}
				class="flex items-center gap-2 rounded-full bg-white/12 px-4 py-2.5 text-sm font-medium text-white shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
			>
				<span
					class="flex size-4 items-center justify-center rounded ring-1 ring-white/50 {skipActive
						? 'bg-white text-slate-950'
						: 'bg-transparent text-transparent'}"
				>
					<Check class="size-3" />
				</span>
				Skip active{activeSkipSegment.label ? ` (${activeSkipSegment.label})` : ''}
			</button>
		</div>
	{/if}
{/snippet}

{#snippet bottomOverlay()}
	<div
		class="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-linear-to-t from-slate-950/90 via-slate-950/50 to-transparent px-6 pt-20 pb-3 transition-opacity duration-300 sm:px-10 {controlsVisible
			? 'opacity-100'
			: 'pointer-events-none opacity-0'}"
	>
		<div class="flex items-end justify-between gap-6">
			<!-- Volume: vertical, bottom-left -->
			<div class="flex flex-col items-center gap-2">
				<span class="text-xs text-white/60 tabular-nums">{Math.round(volume * 100)}%</span>
				<Slider
					bind:value={volume}
					min={0}
					max={1}
					step={0.005}
					orientation="vertical"
					label="Volume"
					sensitivity={600}
					disabled={locked}
				/>
				<Volume2 class="size-5 text-white/70" />
			</div>

			<!-- Playback controls, centered -->
			<div class="flex flex-wrap items-center justify-center gap-3">
				<button
					type="button"
					onclick={() => seekBy(-10)}
					disabled={locked}
					aria-label="Back 10 seconds"
					class="flex items-center gap-1 rounded-full bg-white/12 px-4 py-3 text-xs font-medium text-white/90 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
				>
					<RotateCcw class="size-5" />
					10
				</button>
				<button
					bind:this={playPauseButton}
					type="button"
					onclick={togglePlayPause}
					aria-label={playing ? 'Pause' : 'Play'}
					class="rounded-full bg-white p-3 text-slate-950 shadow-lg transition hover:bg-white/90 focus:outline-none"
				>
					{#if playing}
						<Pause class="size-5" fill="currentColor" />
					{:else}
						<Play class="size-5" fill="currentColor" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => seekBy(10)}
					disabled={locked}
					aria-label="Forward 10 seconds"
					class="flex items-center gap-1 rounded-full bg-white/12 px-4 py-3 text-xs font-medium text-white/90 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
				>
					10
					<RotateCw class="size-5" />
				</button>
			</div>

			<!-- Quality: buttons, bottom-right. A vertical list rather than a
			     single cycling button so every option (and whether it's direct
			     or proxied) is visible and individually reachable at once --
			     swiping the phone remote here moves between them exactly like
			     any other on-screen list. -->
			<div class="flex flex-col items-center gap-2">
				<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
					<Gauge class="size-4" />
					Quality
				</span>
				{#each QUALITY_OPTIONS as option (option)}
					{@render qualityButton(option)}
				{/each}
			</div>
		</div>

		<!-- Progress, slim, flush at the very bottom -->
		<div class="mx-auto flex w-full max-w-2xl items-center gap-3 sm:w-1/2">
			<span class="w-10 text-right text-xs text-white/60 tabular-nums">
				{formatTime(scrubPosition)}
			</span>
			<Slider
				bind:value={scrubPosition}
				liveValue={position}
				onCommit={(seconds) => seek(seconds)}
				min={0}
				max={duration}
				step={1}
				orientation="horizontal"
				label="Seek"
				sensitivity={1500}
				size="sm"
				disabled={locked}
			/>
			<span class="w-10 text-xs text-white/60 tabular-nums">{formatTime(duration)}</span>
		</div>
	</div>
{/snippet}

<div class="fixed inset-0 bg-black">
	{#if errorMessage}
		{@render errorScreen()}
	{:else}
		<!-- svelte-ignore a11y_media_has_caption -->
		<!-- No src/autoplay here -- setupPlayback (see script) owns videoEl.src
		     imperatively, since which mode it ends up in (direct/mse/ffmpeg)
		     isn't known until it actually tries. -->
		<video
			bind:this={videoEl}
			class="size-full object-contain"
			ontimeupdate={() => (currentTime = videoEl?.currentTime ?? 0)}
			onplay={() => (playing = true)}
			onpause={() => (playing = false)}
			onvolumechange={() => (volume = videoEl?.volume ?? 1)}
			onwaiting={() => (buffering = true)}
			onplaying={() => (buffering = false)}
			oncanplay={() => (buffering = false)}
			onended={goBack}
			onerror={() => {
				// A direct/MSE failure fires this same native error event
				// alongside our own JS-level handling (attachDualTrackSource's
				// onError) -- showing the fatal screen here unconditionally
				// would swap {#if errorMessage} to the error branch and destroy
				// this <video> element out from under a fallback that's only
				// just starting, before it gets a chance to load. Only once
				// we're already on the last-resort ffmpeg path is there
				// nothing left to fall back to.
				if (mode === 'ffmpeg') {
					errorMessage = 'The stream stopped unexpectedly.';
				} else {
					const mediaError = videoEl?.error;
					fallbackToFfmpeg(
						position,
						mediaError
							? `native video error ${mediaError.code}: ${mediaError.message || '(no message)'}`
							: 'native video error (no detail available)'
					);
				}
			}}
		></video>

		{#if buffering}
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
				<LoaderCircle class="size-12 animate-spin text-white/80" />
			</div>
		{/if}

		{@render topOverlay()}
		{@render bottomOverlay()}
		{@render skipSegmentBanner()}
	{/if}
</div>
