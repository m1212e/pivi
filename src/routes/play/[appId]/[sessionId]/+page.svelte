<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import Button from '#lib/components/Button.svelte';
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
		Check,
		Captions,
		Sparkles
	} from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { client } from '#lib/api/rumbleClient/client';
	import Slider from '#lib/components/Slider.svelte';
	import Select from '#lib/components/Select.svelte';
	import {
		attachDualTrackSource,
		type DualTrackHandle,
		type SegmentBaseIndex
	} from '#lib/mse/dualTrackPlayer';
	import {
		DEFAULT_QUALITY,
		QUALITY_OPTIONS,
		bestInitialQuality,
		isMseCandidate,
		isQualityOption,
		qualityModeFor as qualityModeOf,
		toQualityMeta,
		type QualityMeta,
		type QualityMode,
		type QualityOption
	} from '#lib/playback/quality';
	import { createSessionUrls, mimeTypeFor, nextSessionHref } from '#lib/playback/urls';
	import { clampSeek, settleTimeUpdate, type SeekTarget } from '#lib/playback/seek';
	import { nextSkipStep, skipTarget, type SkipSegment } from '#lib/playback/skipSegments';
	import { browserStorage } from '#lib/storage';
	import {
		clampVolume,
		isOfferedSubtitle,
		loadSkipActive,
		loadSubtitleLanguage,
		loadVolume,
		saveSkipActive,
		saveSubtitleLanguage,
		saveVolume
	} from '#lib/playback/preferences';
	import { describeError } from '#lib/playback/errors';
	import { bufferedAheadSeconds, formatTime } from '#lib/playback/time';

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

	const appId = page.params.appId!;
	const sessionId = page.params.sessionId!;
	// Set when the session was started from a sequence such as a playlist.
	const context = page.url.searchParams.get('context');
	const urls = createSessionUrls(appId, sessionId);
	const storage = browserStorage(browser);

	// 404 means no sidx or Cues index, so MSE can't work and the caller falls back to ffmpeg.
	async function fetchSegmentIndex(url: string): Promise<SegmentBaseIndex> {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Could not locate segment index (${res.status})`);
		return res.json();
	}

	let quality = $state<QualityOption>(DEFAULT_QUALITY);

	const streamUrlFor = (seconds: number) => urls.stream(seconds, quality);

	// Metadata only, raw stream URLs stay on the server.
	// Fetched once, title and duration don't change mid-session.
	// Codecs depend on the tier, so qualityMeta tracks them per option.
	const info = await client.liveQuery.appPlaybackInfo({
		__args: { appId, sessionId, maxHeight: DEFAULT_QUALITY },
		title: true,
		duration: true,
		direct: true,
		vcodec: true,
		acodec: true,
		videoContainer: true,
		audioContainer: true,
		subtitleTracks: { language: true, label: true, kind: true }
	});

	// Narrower than the app-facing SubtitleTrack on purpose. Url and format never reach the client.
	type SubtitleTrack = {
		language: string;
		label: string | null;
		kind: 'caption' | 'transcription';
	};
	const subtitleTracks = $derived<SubtitleTrack[]>(
		(info?.subtitleTracks ?? []).map((t) => ({
			language: t.language,
			label: t.label,
			kind: t.kind as SubtitleTrack['kind']
		}))
	);

	// Off (null) always comes first.
	const subtitleOptions = $derived<(string | null)[]>([
		null,
		...subtitleTracks.map((t) => t.language)
	]);

	// null means captions off.
	let subtitleLanguage = $state<string | null>(loadSubtitleLanguage(storage));

	function selectSubtitle(language: string | null) {
		subtitleLanguage = language;
		saveSubtitleLanguage(storage, language);
	}

	// Fetched in the background, starting playback doesn't depend on it.
	let skipSegments = $state<SkipSegment[]>([]);
	client.query
		.appSkipSegments({
			__args: { appId, sessionId },
			startSeconds: true,
			endSeconds: true,
			label: true
		})
		.then((result) => {
			skipSegments = result ?? [];
		})
		.catch(() => {});

	// Per tier: direct or proxied, and codecs. Shown as icons in the quality list.
	// undefined means still resolving.
	// Whether a tier has a usable sidx or Cues index. Only the index endpoint can tell.
	// undefined means not probed yet, or never an MSE candidate.
	let mseAvailability = $state<Partial<Record<QualityOption, boolean>>>({});

	async function probeMse(option: QualityOption, meta: QualityMeta) {
		if (!isMseCandidate(meta)) return;
		try {
			await Promise.all([
				fetchSegmentIndex(urls.trackIndex('video', meta.videoContainer, option)),
				fetchSegmentIndex(urls.trackIndex('audio', meta.audioContainer, option))
			]);
			mseAvailability = { ...mseAvailability, [option]: true };
		} catch {
			mseAvailability = { ...mseAvailability, [option]: false };
		}
	}

	let qualityMeta = $state<Partial<Record<QualityOption, QualityMeta>>>({
		[DEFAULT_QUALITY]: info ? toQualityMeta(info) : undefined
	});

	const qualityModeFor = (option: QualityOption): QualityMode | undefined =>
		qualityModeOf(qualityMeta[option], mseAvailability[option]);

	// Same modes as the list icons, so the phone shows the same indicators.
	const qualityModes = $derived(
		Object.fromEntries(
			QUALITY_OPTIONS.map((option) => [option, qualityModeFor(option)]).filter(
				(entry): entry is [QualityOption, QualityMode] => entry[1] !== undefined
			)
		)
	);

	// info already resolved the default tier, don't ask twice.
	async function resolveQualityMeta(option: QualityOption): Promise<QualityMeta | undefined> {
		if (option === DEFAULT_QUALITY) return info ? toQualityMeta(info) : undefined;
		const result = await client.query
			.appPlaybackInfo({
				__args: { appId, sessionId, maxHeight: option },
				direct: true,
				vcodec: true,
				acodec: true,
				videoContainer: true,
				audioContainer: true
			})
			.catch(() => undefined);
		return result ? toQualityMeta(result) : undefined;
	}

	// Resolve every tier up front so the icons are real and the initial pick can compare them.
	const qualityResolutions = QUALITY_OPTIONS.map(async (option) => {
		const meta = await resolveQualityMeta(option);
		if (!meta) return;
		qualityMeta = { ...qualityMeta, [option]: meta };
		await probeMse(option, meta);
	});

	// Start on the best tier confirmed for MSE, else the default.
	let readyForInitialAttach = $state(false);
	Promise.allSettled(qualityResolutions).then(() => {
		quality = bestInitialQuality(mseAvailability);
		readyForInitialAttach = true;
	});

	let videoEl: HTMLVideoElement | undefined = $state();
	let playing = $state(false);
	let currentTime = $state(0);
	let volume = $state(loadVolume(storage));
	let errorMessage = $state<string | null>(null);
	// True from the start, the first frame always has a gap.
	let buffering = $state(true);

	// An ffmpeg seek reopens the stream at a new offset, so the element clock only counts from there.
	let seekOffset = $state(0);
	const position = $derived(seekOffset + currentTime);

	// Where the last seek should land, until playback gets there.
	// Without it the progress bar jumps after a scrub. The element reports the old
	// time for a moment and an ffmpeg reopen adds the offset twice.
	let seekTarget = $state<SeekTarget>(null);

	function applyTimeUpdate(next: number) {
		const settled = settleTimeUpdate(seekTarget, seekOffset, next, performance.now());
		seekTarget = settled.target;
		if (settled.apply) currentTime = next;
	}
	const duration = info?.duration ?? 0;
	const title = info?.title ?? '';
	// Slider value. Follows position until the user drags.
	let scrubPosition = $state(0);

	// Three ways to play, best first.
	// direct: one URL, plain <video src>, native seeking.
	// mse: separate tracks via Shaka over the range proxy, no remuxing.
	// ffmpeg: live remux proxy. Works everywhere but slowest, so last resort.
	let mode = $state<'direct' | 'mse' | 'ffmpeg'>('ffmpeg');
	let dualTrackHandle: DualTrackHandle | undefined;
	// Video and audio pumps can both fail at once. A second fallback would tear
	// down a SourceBuffer the first one is already discarding.
	let fallenBack = false;
	// Shown in the diagnostics panel so nobody has to dig through the console.
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
		// Same reset as reloadFfmpegStream below, for the same reason.
		currentTime = 0;
		videoEl.src = streamUrlFor(seekOffset);
		videoEl.load();
		videoEl.play().catch(() => {});
	}

	// Also used for quality switches, which are a fresh setup on a different stream.
	// Async because attaching Shaka loads a manifest.
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
				fetchSegmentIndex(urls.trackIndex('video', meta.videoContainer, quality)),
				fetchSegmentIndex(urls.trackIndex('audio', meta.audioContainer, quality))
			]);
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

	async function setupPlayback(meta: QualityMeta, resumeSeconds: number) {
		if (!videoEl) return;
		fallenBack = false;
		lastFallbackReason = null;
		dualTrackHandle?.destroy().catch(() => {});
		dualTrackHandle = undefined;
		buffering = true;
		seekOffset = 0;
		// Show the resume point now, the old stream's time is stale.
		currentTime = resumeSeconds;
		seekTarget = null;

		if (meta.direct) {
			setupDirectPlayback(videoEl, resumeSeconds);
			return;
		}
		if (isMseCandidate(meta)) {
			await setupMsePlayback(videoEl, meta, resumeSeconds);
			return;
		}
		fallbackToFfmpeg(resumeSeconds, 'no audio track resolved for this session');
	}

	function reloadFfmpegStream(el: HTMLVideoElement, seconds: number) {
		buffering = true;
		seekOffset = seconds;
		// The new request starts at 0 on its own clock. Reset so position doesn't add the old elapsed time.
		currentTime = 0;
		el.src = streamUrlFor(seconds);
		el.load();
		el.play().catch(() => {});
	}

	function seek(seconds: number) {
		if (!videoEl || duration <= 0) return;
		const clamped = clampSeek(seconds, duration);
		const el = videoEl;
		// Direct streams seek natively, mse goes through Shaka.
		const seekActions: Record<typeof mode, () => void> = {
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

	function seekBy(deltaSeconds: number) {
		seek(position + deltaSeconds);
	}

	// Persisted so it doesn't need deciding per segment.
	let skipActive = $state(loadSkipActive(storage));

	let activeSkipSegment = $state<SkipSegment | null>(null);
	// Keyed by reference so scrubbing back into a segment doesn't bring it back.
	const decidedSkipSegments = new SvelteSet<SkipSegment>();

	function resolveSkipSegment(segment: SkipSegment) {
		decidedSkipSegments.add(segment);
		activeSkipSegment = null;
		const target = skipTarget(segment, skipActive, playing);
		if (target !== null) seek(target);
	}

	$effect(() => {
		const step = nextSkipStep({
			segments: skipSegments,
			decided: decidedSkipSegments,
			active: activeSkipSegment,
			position,
			playing,
			buffering
		});
		if (step.kind === 'resolve') resolveSkipSegment(step.segment);
		else activeSkipSegment = step.segment;
	});

	function togglePlayPause() {
		if (!videoEl) return;
		if (videoEl.paused) videoEl.play().catch(() => {});
		else videoEl.pause();
	}

	// The phone drives playback through DOM events so it works while controls are locked.
	const PLAYER_ACTIONS = {
		playPause: () => togglePlayPause(),
		seekBack: () => seekBy(-10),
		seekForward: () => seekBy(10),
		toggleInfo: () => (diagnosticsOpen = !diagnosticsOpen)
	} as const;
	$effect(() => {
		function onRemoteAction(event: Event) {
			const { action } = (event as CustomEvent<{ action: keyof typeof PLAYER_ACTIONS }>).detail;
			PLAYER_ACTIONS[action]?.();
		}
		// Seek and quality from the phone skip `locked` too.
		function onRemoteSeek(event: Event) {
			const { seconds } = (event as CustomEvent<{ seconds: number }>).detail;
			seek(seconds);
		}
		function onRemoteQuality(event: Event) {
			const { quality: target } = (event as CustomEvent<{ quality: number }>).detail;
			if (isQualityOption(target)) selectQuality(target);
		}
		function onRemoteSubtitle(event: Event) {
			const { language } = (event as CustomEvent<{ language: string | null }>).detail;
			if (isOfferedSubtitle(subtitleTracks, language)) selectSubtitle(language);
		}
		function onRemoteVolume(event: Event) {
			const { volume: target } = (event as CustomEvent<{ volume: number }>).detail;
			volume = clampVolume(target);
		}
		document.addEventListener('pivi-player-action', onRemoteAction);
		document.addEventListener('pivi-player-seek', onRemoteSeek);
		document.addEventListener('pivi-player-quality', onRemoteQuality);
		document.addEventListener('pivi-player-subtitle', onRemoteSubtitle);
		document.addEventListener('pivi-player-volume', onRemoteVolume);
		return () => {
			document.removeEventListener('pivi-player-action', onRemoteAction);
			document.removeEventListener('pivi-player-seek', onRemoteSeek);
			document.removeEventListener('pivi-player-quality', onRemoteQuality);
			document.removeEventListener('pivi-player-subtitle', onRemoteSubtitle);
			document.removeEventListener('pivi-player-volume', onRemoteVolume);
		};
	});

	// Quality, subtitle pick and the info panel change without a DOM mutation RemoteBridge would see.
	$effect(() => {
		void quality;
		void subtitleLanguage;
		void diagnosticsOpen;
		// Position too. RemoteBridge's timeupdate push runs before this page renders
		// the new value, so the phone's progress bar would trail by a tick.
		void position;
		document.dispatchEvent(new CustomEvent('pivi-player-state-changed'));
	});

	// Pushes slider changes onto the element. Guarded so it doesn't fight onvolumechange.
	$effect(() => {
		if (videoEl && Math.abs(videoEl.volume - volume) > 0.001) videoEl.volume = volume;
	});

	// Remembered for the next session.
	$effect(() => saveVolume(storage, volume));
	$effect(() => saveSkipActive(storage, skipActive));

	// The <track> elements stay put across quality switches and fallbacks.
	// Only the selected one leaves 'disabled', so cues load for just that language.
	$effect(() => {
		if (!videoEl) return;
		const tracks = videoEl.textTracks;
		for (let i = 0; i < tracks.length; i++) {
			tracks[i].mode = tracks[i].language === subtitleLanguage ? 'showing' : 'disabled';
		}
	});

	// One-time initial attach once the video exists and the quality pick settled.
	// Always starts from 0, there's no saved play state.
	let initialized = false;
	function attachInitialPlayback() {
		const meta = qualityMeta[quality];
		if (meta) setupPlayback(meta, 0);
	}
	$effect(() => {
		if (initialized || !videoEl || !readyForInitialAttach) return;
		initialized = true;
		attachInitialPlayback();
	});

	// Stop Shaka fetching after leaving the page.
	$effect(() => {
		return () => {
			dualTrackHandle?.destroy().catch(() => {});
		};
	});

	// A quality switch can change the whole mode, so it's a fresh setupPlayback.
	// Fetch the meta here only if the background resolve hasn't finished.
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
			.appPlaybackInfo({
				__args: { appId, sessionId, maxHeight: target },
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

	// A failed lookup counts as no next entry.
	async function nextSessionId(sequence: string): Promise<string | undefined> {
		try {
			const result = await client.query.appNextSession({
				__args: { appId, sessionId, context: sequence },
				sessionId: true
			});
			return result?.sessionId ?? undefined;
		} catch {
			return undefined;
		}
	}

	// Plays the next entry or leaves. Replacing the entry keeps one back press enough.
	async function onVideoEnded() {
		if (!context) return goBack();
		const nextId = await nextSessionId(context);
		if (nextId) {
			return goto(nextSessionHref(appId, nextId, context), { replaceState: true });
		}
		goBack();
	}

	// Hidden only while playing, paused keeps it up.
	let controlsVisible = $state(true);
	const CONTROLS_IDLE_MS = 3000;
	let idleTimeout: ReturnType<typeof setTimeout> | undefined;

	// While hidden, everything but play/pause is out of reach so a stray swipe
	// can't trigger something the viewer never saw.
	const locked = $derived(!controlsVisible);
	let playPauseButton = $state<HTMLButtonElement>();

	// Focus something on arrival, one time only.
	let focusedOnMount = false;
	$effect(() => {
		if (playPauseButton && !focusedOnMount) {
			focusedOnMount = true;
			playPauseButton.focus();
		}
	});

	// Move focus before hiding. Once the old target is disabled the browser resets
	// focus to <body> and its focusin would re-show the controls.
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

	// Reads `playing` so the countdown re-arms or cancels as playback starts and stops.
	$effect(() => {
		showControls();
	});

	// Ignore the focusin from hideControls' own focus() call.
	let suppressNextFocusActivity = false;

	// Document level so remote driven focus and clicks count as activity too.
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

	// Subset of shaka's Stats, avoids importing its types here.
	type ShakaStats = {
		estimatedBandwidth: number;
		streamBandwidth: number;
		bytesDownloaded: number;
		decodedFrames: number;
		droppedFrames: number;
		bufferingTime: number;
		stallsDetected: number;
	};

	// Polled, none of this is reactive. Only runs while the panel is open.
	let diagnosticsOpen = $state(false);
	let diagnostics = $state({
		resolution: '—',
		readyState: 0,
		networkState: 0,
		bufferedAheadSeconds: 0,
		shakaStats: null as ShakaStats | null
	});

	function bufferedAheadSecondsFor(el: HTMLVideoElement | undefined): number {
		return el ? bufferedAheadSeconds(el.buffered, el.currentTime) : 0;
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

<svelte:head><title>{title || m.playing()}</title></svelte:head>

{#snippet errorScreen()}
	<div class="flex size-full flex-col items-center justify-center gap-3 text-white">
		<p class="text-lg font-medium">{m.playback_failed()}</p>
		<p class="max-w-sm text-center text-sm text-white/60">{errorMessage}</p>
		<Button variant="solid" size="md" onclick={goBack} class="mt-2">
			{m.back()}
		</Button>
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

<!-- Overlays sit on top of the video. Faded instead of unmounted while idle so
     remote focus can still reach them and bring the UI back. -->
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
				aria-label={m.back()}
				class="rounded-full bg-white/12 p-3 text-white shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
			>
				<ArrowLeft class="size-5" />
			</button>
			<h1 class="min-w-0 flex-1 truncate text-lg font-medium text-white sm:text-xl">{title}</h1>
			<button
				type="button"
				onclick={() => (diagnosticsOpen = !diagnosticsOpen)}
				disabled={locked}
				aria-label={m.playback_diagnostics()}
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

<!-- onLight: this rendering sits on the selected row's white background. -->
{#snippet qualityOption(opt: QualityOption, onLight: boolean)}
	{@const mode = qualityModeFor(opt)}
	<span>{opt}p</span>
	{#if mode === 'direct'}
		<span title={m.quality_mode_direct()}>
			<Zap class="size-4 {onLight ? 'text-emerald-600' : 'text-emerald-400'}" />
		</span>
	{:else if mode === 'mse'}
		<span title={m.quality_mode_mse()}>
			<Layers class="size-4 {onLight ? 'text-sky-600' : 'text-sky-400'}" />
		</span>
	{:else if mode === 'ffmpeg'}
		<span title={m.quality_mode_ffmpeg()}>
			<Server class="size-4 {onLight ? 'text-amber-600' : 'text-amber-400'}" />
		</span>
	{/if}
{/snippet}

{#snippet subtitleOption(language: string | null, onLight: boolean)}
	{@const track = subtitleTracks.find((t) => t.language === language) ?? null}
	<span class="min-w-0 truncate">{track ? (track.label ?? track.language) : m.subtitles_off()}</span
	>
	{#if track?.kind === 'transcription'}
		<span title={m.subtitles_auto_generated()}>
			<Sparkles class="size-4 shrink-0 {onLight ? 'text-amber-600' : 'text-amber-400'}" />
		</span>
	{/if}
{/snippet}

<!-- Not locked and outside the fading container, since a skip is coming
     whether or not the rest of the UI is visible. Offsets are fixed because
     it has to hold its spot while the row below is faded out. -->
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
		<!-- Three grid tracks instead of flex, so the playback controls stay
		     centered whatever the side columns contain. -->
		<div class="grid grid-cols-3 items-end gap-6">
			<!-- Volume: vertical, bottom-left -->
			<div class="flex flex-col items-center gap-2 justify-self-start">
				<span class="text-xs text-white/60 tabular-nums">{Math.round(volume * 100)}%</span>
				<Slider
					bind:value={volume}
					min={0}
					max={1}
					step={0.005}
					orientation="vertical"
					label={m.volume()}
					sensitivity={600}
					disabled={locked}
				/>
				<Volume2 class="size-5 text-white/70" />
			</div>

			<!-- Playback controls, centered -->
			<div class="flex flex-wrap items-center justify-center gap-3 justify-self-center">
				<button
					type="button"
					onclick={() => seekBy(-10)}
					disabled={locked}
					aria-label={m.seek_back()}
					class="flex items-center gap-1 rounded-full bg-white/12 px-4 py-3 text-xs font-medium text-white/90 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
				>
					<RotateCcw class="size-5" />
					10
				</button>
				<button
					bind:this={playPauseButton}
					type="button"
					onclick={togglePlayPause}
					aria-label={playing ? m.pause() : m.play()}
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
					aria-label={m.seek_forward()}
					class="flex items-center gap-1 rounded-full bg-white/12 px-4 py-3 text-xs font-medium text-white/90 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
				>
					10
					<RotateCw class="size-5" />
				</button>
			</div>

			<!-- One column so the group's width, and the centering, doesn't depend on
			     whether the subtitle picker shows. -->
			<div class="flex flex-col items-center gap-3 justify-self-end">
				<!-- A Select since caption tracks can run into the dozens. Hidden without
				     tracks, an Off-only picker is no choice. -->
				{#if subtitleTracks.length > 0}
					<div class="flex flex-col items-center gap-2">
						<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
							<Captions class="size-4" />
							Subtitles
						</span>
						<Select
							value={subtitleLanguage}
							onChange={selectSubtitle}
							options={subtitleOptions}
							label={m.subtitles()}
							disabled={locked}
							option={subtitleOption}
						/>
					</div>
				{/if}

				<!-- Quality: a Select for consistency with Subtitles. -->
				<div class="flex flex-col items-center gap-2">
					<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
						<Gauge class="size-4" />
						Quality
					</span>
					<Select
						value={quality}
						onChange={selectQuality}
						options={QUALITY_OPTIONS}
						label={m.quality()}
						disabled={locked}
						option={qualityOption}
					/>
				</div>
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
				label={m.seek()}
				sensitivity={1500}
				size="sm"
				disabled={locked}
			/>
			<span class="w-10 text-xs text-white/60 tabular-nums">{formatTime(duration)}</span>
		</div>
	</div>
{/snippet}

<div
	class="fixed inset-0 bg-black"
	data-pivi-player
	data-pivi-player-position={position}
	data-pivi-player-duration={duration}
	data-pivi-player-quality={quality}
	data-pivi-player-quality-options={QUALITY_OPTIONS.join(',')}
	data-pivi-player-quality-modes={JSON.stringify(qualityModes)}
	data-pivi-player-subtitle-language={subtitleLanguage ?? ''}
	data-pivi-player-subtitle-tracks={JSON.stringify(subtitleTracks)}
	data-pivi-player-diagnostics-open={diagnosticsOpen}
	data-pivi-player-volume={volume}
>
	{#if errorMessage}
		{@render errorScreen()}
	{:else}
		<!-- No src here, setupPlayback sets it since the mode isn't known until it tries. -->
		<video
			bind:this={videoEl}
			class="size-full object-contain"
			ontimeupdate={() => applyTimeUpdate(videoEl?.currentTime ?? 0)}
			onplay={() => (playing = true)}
			onpause={() => (playing = false)}
			onvolumechange={() => (volume = videoEl?.volume ?? 1)}
			onwaiting={() => (buffering = true)}
			onplaying={() => (buffering = false)}
			oncanplay={() => (buffering = false)}
			onended={onVideoEnded}
			onerror={() => {
				// Direct and MSE failures fire this too, next to our own handling.
				// Showing the error screen would destroy the <video> mid fallback.
				// Only show it on ffmpeg, where nothing is left to fall back to.
				if (mode === 'ffmpeg') {
					errorMessage = m.stream_stopped();
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
		>
			<!-- Independent of mode. Shaka never touches <track> children, and the effect
			     above turns on the selected language. -->
			{#each subtitleTracks as track (track.language)}
				<track
					kind="subtitles"
					srclang={track.language}
					label={track.label ?? track.language}
					src={urls.subtitle(track.language)}
				/>
			{/each}
		</video>

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

<style>
	/* Some tracks leave cue alignment unset or not centered. Force it for consistent captions. */
	video::cue {
		text-align: center;
	}
</style>
