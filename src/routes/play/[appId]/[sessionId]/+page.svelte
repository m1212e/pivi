<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import { LoaderCircle } from '@lucide/svelte';
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { client } from '#lib/api/rumbleClient/client';
	import { createControlsVisibility } from '#lib/playback/controlsVisibility.svelte';
	import { createDiagnostics } from '#lib/playback/diagnostics.svelte';
	import { createPlayerEngine } from '#lib/playback/engine.svelte';
	import {
		clampVolume,
		loadSubtitleLanguage,
		loadVolume,
		saveSubtitleLanguage,
		saveVolume
	} from '#lib/playback/preferences';
	import {
		normalizeQualities,
		screenStartHeight,
		startQuality,
		toQualityMeta,
		type QualityOption
	} from '#lib/playback/quality';
	import { createQualityCatalog } from '#lib/playback/qualityCatalog.svelte';
	import {
		announcePlayerStateChange,
		bindRemotePlayerEvents,
		playerBridgeAttributes
	} from '#lib/playback/remoteBridge';
	import { SEEK_STEP_SECONDS } from '#lib/playback/seek';
	import { createSkipController } from '#lib/playback/skipController.svelte';
	import { toSubtitleTracks } from '#lib/playback/subtitles';
	import { createSessionUrls, nextSessionHref } from '#lib/playback/urls';
	import { browserStorage } from '#lib/storage';
	import BottomOverlay from './BottomOverlay.svelte';
	import DiagnosticsPanel from './DiagnosticsPanel.svelte';
	import ErrorScreen from './ErrorScreen.svelte';
	import SkipSegmentBanner from './SkipSegmentBanner.svelte';
	import TopOverlay from './TopOverlay.svelte';

	const appId = page.params.appId!;
	const sessionId = page.params.sessionId!;
	// Set when the session was started from a sequence such as a playlist.
	const context = page.url.searchParams.get('context');
	const urls = createSessionUrls(appId, sessionId);
	const storage = browserStorage(browser);

	const preferredHeight = screenStartHeight();

	// What differs per quality tier. Codecs depend on the tier, so they are
	// asked for again on every switch.
	const TIER_FIELDS = {
		direct: true,
		vcodec: true,
		acodec: true,
		videoContainer: true,
		audioContainer: true
	} as const;

	// Metadata only, raw stream URLs stay on the server.
	// Fetched once, title and duration don't change mid-session.
	const info = await client.liveQuery.appPlaybackInfo({
		__args: { appId, sessionId, maxHeight: preferredHeight },
		title: true,
		duration: true,
		qualities: true,
		...TIER_FIELDS,
		subtitleTracks: { language: true, label: true, kind: true }
	});
	const duration = info?.duration ?? 0;
	const title = info?.title ?? '';
	// Empty for an app without a quality choice, then nothing is capped or offered.
	const qualities = normalizeQualities(info?.qualities);
	const initialQuality = startQuality(qualities, preferredHeight);
	const subtitleTracks = $derived(toSubtitleTracks(info?.subtitleTracks));

	let videoEl: HTMLVideoElement | undefined = $state();
	let playPauseButton = $state<HTMLButtonElement>();
	let quality = $state<QualityOption | undefined>(initialQuality);
	let volume = $state(loadVolume(storage));
	// null means captions off.
	let subtitleLanguage = $state<string | null>(loadSubtitleLanguage(storage));

	const catalog = createQualityCatalog({
		urls,
		qualities,
		startQuality: initialQuality,
		defaultMeta: info ? toQualityMeta(info) : undefined,
		fetchMeta: (option) =>
			client.query
				.appPlaybackInfo({ __args: { appId, sessionId, maxHeight: option }, ...TIER_FIELDS })
				.then((result) => (result ? toQualityMeta(result) : undefined))
				.catch(() => undefined)
	});

	const engine = createPlayerEngine({
		urls,
		duration,
		getVideo: () => videoEl,
		getQuality: () => quality
	});

	const diagnostics = createDiagnostics({
		getVideo: () => videoEl,
		getShakaStats: engine.getShakaStats
	});

	const skip = createSkipController({
		storage,
		fetchSegments: async () =>
			(await client.query.appSkipSegments({
				__args: { appId, sessionId },
				startSeconds: true,
				endSeconds: true,
				label: true
			})) ?? [],
		getPosition: () => engine.position,
		getPlaying: () => engine.playing,
		getBuffering: () => engine.buffering,
		seek: engine.seek
	});

	const controls = createControlsVisibility({
		getPlaying: () => engine.playing,
		getFocusTarget: () => playPauseButton
	});

	// Start on the best tier confirmed for MSE, else the start tier. Always from 0,
	// there's no saved play state.
	let readyForInitialAttach = $state(false);
	catalog.resolveAll().then(() => {
		quality = catalog.bestInitial();
		readyForInitialAttach = true;
	});
	let attached = false;
	const canAttach = $derived(!!videoEl && readyForInitialAttach);
	function attachInitialPlayback() {
		attached = true;
		const meta = catalog.metaFor(quality);
		if (meta) engine.setupPlayback(meta, 0);
	}
	$effect(() => {
		if (canAttach && !attached) attachInitialPlayback();
	});

	// A quality switch can change the whole mode, so it's a fresh setup.
	async function selectQuality(target: QualityOption) {
		if (target === quality) return;
		const resumeAt = engine.position;
		quality = target;
		const meta = await catalog.ensure(target);
		if (meta && quality === target) engine.setupPlayback(meta, resumeAt);
	}

	function selectSubtitle(language: string | null) {
		subtitleLanguage = language;
		saveSubtitleLanguage(storage, language);
	}

	// The phone drives playback through DOM events so it works while controls are locked.
	$effect(() =>
		bindRemotePlayerEvents({
			onAction: (action) =>
				({
					playPause: engine.togglePlayPause,
					seekBack: () => engine.seekBy(-SEEK_STEP_SECONDS),
					seekForward: () => engine.seekBy(SEEK_STEP_SECONDS),
					toggleInfo: diagnostics.toggle
				})[action](),
			onSeek: engine.seek,
			onQuality: selectQuality,
			onSubtitle: selectSubtitle,
			onVolume: (target) => (volume = clampVolume(target)),
			getSubtitleTracks: () => subtitleTracks,
			getQualities: () => qualities
		})
	);

	// Quality, subtitle pick and the info panel change without a DOM mutation RemoteBridge would see.
	$effect(() => {
		void quality;
		void subtitleLanguage;
		void diagnostics.open;
		// Position too. RemoteBridge's timeupdate push runs before this page renders
		// the new value, so the phone's progress bar would trail by a tick.
		void engine.position;
		announcePlayerStateChange();
	});

	const bridgeAttributes = $derived(
		playerBridgeAttributes({
			position: engine.position,
			duration,
			qualities,
			quality,
			qualityModes: catalog.modes,
			subtitleLanguage,
			subtitleTracks,
			diagnosticsOpen: diagnostics.open,
			volume
		})
	);

	// Pushes slider changes onto the element. Guarded so it doesn't fight onvolumechange.
	$effect(() => {
		if (videoEl && Math.abs(videoEl.volume - volume) > 0.001) videoEl.volume = volume;
	});

	// Remembered for the next session.
	$effect(() => saveVolume(storage, volume));

	// The <track> elements stay put across quality switches and fallbacks.
	// Only the selected one leaves 'disabled', so cues load for just that language.
	$effect(() => {
		if (!videoEl) return;
		const tracks = videoEl.textTracks;
		for (let i = 0; i < tracks.length; i++) {
			tracks[i].mode = tracks[i].language === subtitleLanguage ? 'showing' : 'disabled';
		}
	});

	// Focus something on arrival so a remote has a starting point.
	$effect(() => playPauseButton?.focus());

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
</script>

<svelte:head><title>{title || m.playing()}</title></svelte:head>

<!-- Named so the selected card grows into it, see +layout.svelte. -->
<div class="fixed inset-0 bg-black" style:view-transition-name="player-video" {...bridgeAttributes}>
	{#if engine.failed}
		<ErrorScreen message={m.stream_stopped()} onBack={goBack} />
	{:else}
		<!-- No src here, setupPlayback sets it since the mode isn't known until it tries. -->
		<video
			bind:this={videoEl}
			class="size-full object-contain"
			{...engine.videoEvents}
			onvolumechange={() => (volume = videoEl?.volume ?? 1)}
			onended={onVideoEnded}
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

		{#if engine.buffering}
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
				<LoaderCircle class="size-12 animate-spin text-white/80" />
			</div>
		{/if}

		<TopOverlay
			{title}
			visible={controls.visible}
			locked={controls.locked}
			diagnosticsOpen={diagnostics.open}
			onBack={goBack}
			onToggleDiagnostics={diagnostics.toggle}
		>
			<DiagnosticsPanel
				mode={engine.mode}
				{quality}
				meta={catalog.metaFor(quality)}
				snapshot={diagnostics.snapshot}
				position={engine.position}
				{duration}
				buffering={engine.buffering}
				lastFallbackReason={engine.lastFallbackReason}
			/>
		</TopOverlay>

		<BottomOverlay
			visible={controls.visible}
			locked={controls.locked}
			bind:volume
			bind:playPauseButton
			playing={engine.playing}
			position={engine.position}
			{duration}
			{subtitleTracks}
			{subtitleLanguage}
			{qualities}
			{quality}
			modeFor={catalog.modeFor}
			onTogglePlay={engine.togglePlayPause}
			onSeekBy={engine.seekBy}
			onSeek={engine.seek}
			onSubtitle={selectSubtitle}
			onQuality={selectQuality}
		/>

		<SkipSegmentBanner
			segment={skip.pending}
			skipActive={skip.active}
			onToggle={skip.toggleActive}
		/>
	{/if}
</div>

<style>
	/* Some tracks leave cue alignment unset or not centered. Force it for consistent captions. */
	video::cue {
		text-align: center;
	}
</style>
