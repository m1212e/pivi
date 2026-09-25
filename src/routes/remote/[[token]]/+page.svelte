<script lang="ts">
	import { flushSync, onMount } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { browser } from '$app/env';
	// The bare package, not a /node or /browser subpath — see rpcRal.ts for
	// why. ensureRal() below installs the RAL createMessageConnection needs.
	import { createMessageConnection, type Message, type MessageConnection } from 'vscode-jsonrpc';
	import { page } from '$app/state';
	import { connectRemoteSession, type RemoteSession } from '#lib/pairing/session';
	import { ensureRal } from '#lib/rpcRal';
	import { PushMessageReader, SinkMessageWriter } from '#lib/rpcTransport';
	import {
		backNotification,
		enterNotification,
		goHomeNotification,
		keyNotification,
		keyParamsSchema,
		moveNotification,
		moveParamsSchema,
		openUrlNotification,
		openUrlParamsSchema,
		playerActionNotification,
		playerActionParamsSchema,
		playerQualityNotification,
		playerQualityParamsSchema,
		playerSeekNotification,
		playerSeekParamsSchema,
		playerSubtitleNotification,
		playerSubtitleParamsSchema,
		playerVolumeNotification,
		playerVolumeParamsSchema,
		requestStateNotification,
		selectAppNotification,
		selectAppParamsSchema,
		selectNotification,
		selectProfileNotification,
		selectProfileParamsSchema,
		stateNotification,
		stateParamsSchema,
		textNotification,
		textParamsSchema
	} from '#lib/pairing/remoteProtocol';
	import { onNotification, sendNotification } from '#lib/rpc';
	import PinPad from '#lib/components/PinPad.svelte';
	import Select from '#lib/components/Select.svelte';
	import Slider from '#lib/components/Slider.svelte';
	import { profileGradient } from '#lib/profileColor';
	import {
		Captions,
		Gauge,
		Grid3x3,
		Hand,
		Info,
		Keyboard,
		Layers,
		Pause,
		Play,
		RotateCcw,
		RotateCw,
		Server,
		Sparkles,
		Users,
		Volume2,
		Zap
	} from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';

	let phase = $state<'connecting' | 'not-paired' | 'error' | 'ready'>('connecting');
	let errorMessage = $state('');
	let connected = $state(false);
	let session: RemoteSession | undefined;
	let connection: MessageConnection | undefined;

	// What the TV is actually showing right now — reported by RemoteBridge on
	// the TV side, so the phone surfaces exactly the input method the TV
	// needs at this instant, with no manual tab-picking.
	let hasPinPad = $state(false);
	let hasTextInput = $state(false);
	let canGoBack = $state(false);
	let canGoHome = $state(false);
	let profiles = $state<{ id: string; username: string; image: string | null }[]>([]);
	// The home dashboard's own first few app shortcuts -- shown above the
	// trackpad rather than as a tab of their own, since the dashboard is
	// still the trackpad's own home turf.
	let apps = $state<{ id: string; name: string }[]>([]);
	// Whether the TV is on /play/* -- unlike apps/profiles, the player's
	// controls are their own exclusive tab (there's no natural "above the
	// trackpad" spot for them), same as the PIN pad and keyboard.
	let hasPlayer = $state(false);
	// Whether the TV's player is actually playing right now -- drives the
	// play/pause button's icon below, same as a native media player would.
	let playing = $state(false);
	// The TV player's own progress/quality/diagnostics state -- see
	// stateParamsSchema's own comments on each field.
	let position = $state(0);
	let duration = $state(0);
	let quality = $state(0);
	let qualityOptions = $state<number[]>([]);
	let qualityModes = $state<Record<string, 'direct' | 'mse' | 'ffmpeg'>>({});
	// The session's caption tracks and the one showing right now (`null` =
	// off) -- same picker the TV player has, see stateParamsSchema.
	type SubtitleTrack = {
		language: string;
		label: string | null;
		kind: 'caption' | 'transcription';
	};
	let subtitleTracks = $state<SubtitleTrack[]>([]);
	let subtitleLanguage = $state<string | null>(null);
	let diagnosticsOpen = $state(false);
	let volume = $state(0);

	const QUALITY_MODE_ICON = { direct: Zap, mse: Layers, ffmpeg: Server } as const;

	// `null` (Off) always leads, same as the TV player's own list -- it isn't
	// a real track and has nowhere else meaningful to sort into.
	const subtitleChoices = $derived<(string | null)[]>([
		null,
		...subtitleTracks.map((t) => t.language)
	]);

	// Highest first -- the TV reports these ascending, but a picker reads
	// best with the best quality at the top, same as the player's own.
	const qualityChoices = $derived(qualityOptions.toReversed());

	type RequiredTab = 'pin' | 'keyboard' | 'profiles' | 'player' | 'trackpad';
	const requiredTab: RequiredTab = $derived(
		hasPinPad
			? 'pin'
			: hasTextInput
				? 'keyboard'
				: profiles.length > 0
					? 'profiles'
					: hasPlayer
						? 'player'
						: 'trackpad'
	);
	// Stepping onto the trackpad to use its swipe gestures means stepping off
	// whatever the TV actually asked for (a PIN or text field) -- this override
	// lets that happen without losing track of it, and a toggle button (below)
	// offers the way back.
	//
	// Kept in localStorage (this phone's own, not synced anywhere) so
	// reopening the remote -- a reload, or just reconnecting later -- lands
	// back on whichever side of that toggle was last chosen, rather than
	// always resetting to the TV's current requirement.
	const OVERRIDE_STORAGE_KEY = 'pivi-remote-manual-override';

	// Only these two genuinely block using the trackpad at all -- there's no
	// way to type a PIN or fill a text field with swipes, so a fresh one of
	// these always wins over a stale override (see the stateNotification
	// handler below). `profiles`/`player` reappearing is just ordinary
	// navigation (e.g. leaving and returning to the video) and shouldn't
	// itself undo a toggle the person made on purpose.
	const URGENT_TABS = new Set<RequiredTab>(['pin', 'keyboard']);

	function loadStoredOverride(): 'trackpad' | null {
		return browser && localStorage.getItem(OVERRIDE_STORAGE_KEY) === 'trackpad' ? 'trackpad' : null;
	}

	function storeOverride(value: 'trackpad' | null) {
		if (!browser) return;
		if (value) localStorage.setItem(OVERRIDE_STORAGE_KEY, value);
		else localStorage.removeItem(OVERRIDE_STORAGE_KEY);
	}

	let manualOverride = $state<'trackpad' | null>(loadStoredOverride());
	const tab = $derived(manualOverride ?? requiredTab);

	// What `readyMain` actually renders -- kept one tick behind `tab` itself,
	// updated only inside a View Transition (falling back to a plain
	// assignment on browsers without one, namely Firefox/Safari as of
	// writing) so the trackpad and whichever tab it's swapping with morph
	// into each other instead of snapping. Only `tab`'s initial value is
	// wanted here -- the effect below is what keeps it in sync afterward.
	// svelte-ignore state_referenced_locally
	let displayedTab = $state(tab);
	$effect(() => {
		const next = tab;
		if (!document.startViewTransition) {
			displayedTab = next;
			return;
		}
		document.startViewTransition(() => flushSync(() => (displayedTab = next)));
	});

	const TOGGLE_TARGET_ICON = {
		trackpad: Hand,
		pin: Grid3x3,
		keyboard: Keyboard,
		profiles: Users,
		player: Play
	} as const;
	const TOGGLE_TARGET_LABEL = {
		trackpad: m.switch_to_trackpad,
		pin: m.switch_to_pin_pad,
		keyboard: m.switch_to_keyboard,
		profiles: m.switch_to_profiles,
		player: m.switch_to_player
	} as const;

	// What the toggle button below would switch *to* -- the trackpad while
	// showing the TV's requested input, or back to that input while overridden
	// onto the trackpad.
	const toggleTarget = $derived(tab === 'trackpad' ? requiredTab : 'trackpad');
	const ToggleIcon = $derived(TOGGLE_TARGET_ICON[toggleTarget]);
	const toggleLabel = $derived(TOGGLE_TARGET_LABEL[toggleTarget]());

	function toggleTrackpad() {
		manualOverride = tab === 'trackpad' ? null : 'trackpad';
		storeOverride(manualOverride);
		navigator.vibrate?.(6);
	}

	// The progress/volume sliders' own displayed values -- track
	// position/volume while idle, but take over during an active drag (see
	// Slider's liveValue/onCommit props), same as the TV player's own bars.
	let scrubPosition = $state(0);
	let scrubVolume = $state(0);

	let pin = $state('');
	let text = $state('');
	let textInput: HTMLInputElement | undefined = $state();

	// visualViewport shrinks when the on-screen keyboard opens, unlike window.innerHeight.
	// We use that gap to smoothly translate the input up above the keyboard.
	let keyboardInset = $state(0);
	const KEYBOARD_HEIGHT_THRESHOLD = 120;

	function updateKeyboardState() {
		const vv = window.visualViewport;
		if (!vv) return;
		const diff = window.innerHeight - vv.height;
		keyboardInset = diff > KEYBOARD_HEIGHT_THRESHOLD ? diff : 0;
	}

	$effect(() => {
		if (displayedTab === 'keyboard') textInput?.focus();
	});

	let touchOrigin: { x: number; y: number } | null = null;
	let touchMoved = false;
	const MOVE_THRESHOLD = 48;

	function onTouchStart(event: TouchEvent) {
		const t = event.touches[0];
		touchOrigin = { x: t.clientX, y: t.clientY };
		touchMoved = false;
	}

	function reportMove(conn: MessageConnection, t: Touch) {
		const dx = t.clientX - touchOrigin!.x;
		const dy = t.clientY - touchOrigin!.y;
		if (Math.abs(dx) <= MOVE_THRESHOLD && Math.abs(dy) <= MOVE_THRESHOLD) return;
		sendNotification(conn, moveNotification, moveParamsSchema, { dx, dy });
		navigator.vibrate?.(2);
		touchOrigin = { x: t.clientX, y: t.clientY };
		touchMoved = true;
	}

	function onTouchMove(event: TouchEvent) {
		if (!touchOrigin || !connection) return;
		reportMove(connection, event.touches[0]);
	}

	function onTouchEnd() {
		if (!touchMoved) {
			connection?.sendNotification(selectNotification);
			navigator.vibrate?.(8);
		}
		touchOrigin = null;
		touchMoved = false;
	}

	function goBack() {
		connection?.sendNotification(backNotification);
		navigator.vibrate?.(6);
	}

	function goHome() {
		connection?.sendNotification(goHomeNotification);
		navigator.vibrate?.(6);
	}

	function onPinKey(key: string) {
		if (!connection) return;
		sendNotification(connection, keyNotification, keyParamsSchema, { value: key });
		navigator.vibrate?.(4);
	}

	function onPinComplete() {
		pin = '';
	}

	function selectProfile(id: string) {
		if (!connection) return;
		sendNotification(connection, selectProfileNotification, selectProfileParamsSchema, { id });
		navigator.vibrate?.(8);
	}

	function selectApp(id: string) {
		if (!connection) return;
		sendNotification(connection, selectAppNotification, selectAppParamsSchema, { id });
		navigator.vibrate?.(8);
	}

	function playerAction(action: 'playPause' | 'seekBack' | 'seekForward' | 'toggleInfo') {
		if (!connection) return;
		sendNotification(connection, playerActionNotification, playerActionParamsSchema, { action });
		navigator.vibrate?.(action === 'playPause' ? 8 : 4);
	}

	// Fires once the progress slider's drag settles (see Slider's own
	// onCommit) rather than on every intermediate tick -- a seek is expensive
	// on the TV side (it reopens the stream at a new offset), same reason the
	// TV's own progress bar debounces it.
	function seekPlayer(seconds: number) {
		if (!connection) return;
		sendNotification(connection, playerSeekNotification, playerSeekParamsSchema, { seconds });
		navigator.vibrate?.(4);
	}

	function selectQuality(target: number) {
		if (!connection || target === quality) return;
		sendNotification(connection, playerQualityNotification, playerQualityParamsSchema, {
			quality: target
		});
		navigator.vibrate?.(8);
	}

	function selectSubtitle(language: string | null) {
		if (!connection || language === subtitleLanguage) return;
		sendNotification(connection, playerSubtitleNotification, playerSubtitleParamsSchema, {
			language
		});
		navigator.vibrate?.(8);
	}

	// Unlike seekPlayer above, fires on every intermediate drag tick (see the
	// Slider's own onChange) rather than waiting for the drag to settle --
	// setting a volume is cheap on the TV side, so there's no reason to make
	// dragging feel laggy the way debouncing a seek avoids an expensive
	// stream reopen per tick.
	function setVolume(target: number) {
		if (!connection) return;
		sendNotification(connection, playerVolumeNotification, playerVolumeParamsSchema, {
			volume: target
		});
	}

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function onTextInput() {
		if (!connection) return;
		sendNotification(connection, textNotification, textParamsSchema, { value: text });
	}

	function onTextSubmit(event: SubmitEvent) {
		event.preventDefault();
		connection?.sendNotification(enterNotification);
		navigator.vibrate?.(8);
		text = '';
		onTextInput();
	}

	onMount(() => {
		let cancelled = false;

		window.visualViewport?.addEventListener('resize', updateKeyboardState);
		updateKeyboardState();

		// Registered only from this route (not the root layout) so installing
		// "Pivi Remote" to the home screen doesn't put a service worker in
		// front of the rest of the app.
		navigator.serviceWorker?.register('/remote/sw.js', { scope: '/remote/' }).catch(() => {});

		ensureRal();

		// The reader/writer are wired up before `session` exists — the writer
		// sends through whatever `session` holds at call time, and nothing
		// sends anything until the `.then()` below assigns it, so there's no
		// race with messages the TV might push right after the handshake
		// completes.
		const reader = new PushMessageReader();
		const writer = new SinkMessageWriter((msg) => session?.send(msg as Record<string, unknown>));
		connection = createMessageConnection(reader, writer);

		onNotification(connection, stateNotification, stateParamsSchema, (state) => {
			hasPinPad = state.hasPinPad;
			hasTextInput = state.hasTextInput;
			canGoBack = state.canGoBack;
			canGoHome = state.canGoHome;
			profiles = state.profiles;
			apps = state.apps;
			hasPlayer = state.hasPlayer;
			playing = state.playing;
			position = state.position;
			duration = state.duration;
			quality = state.quality;
			qualityOptions = state.qualityOptions;
			qualityModes = state.qualityModes;
			subtitleTracks = state.subtitleTracks;
			subtitleLanguage = state.subtitleLanguage;
			diagnosticsOpen = state.diagnosticsOpen;
			volume = state.volume;
			// Checked on every push, not just a change -- there's no "first call"
			// special case to worry about now that only pin/keyboard ever clear
			// the override (see URGENT_TABS above): if one of those is actually
			// needed right now, the override should never have stood in front of
			// it in the first place, connecting-for-the-first-time included.
			if (URGENT_TABS.has(requiredTab)) {
				manualOverride = null;
				storeOverride(null);
			}
		});
		// Sent directly by the host (not the TV) when a plugin hands off a
		// login — see relay.ts's sendToPhones and SKETCH.md's "Login"
		// decision. A full navigation, not a popup: Google's login page
		// refuses to load in an iframe/embedded context anyway, and this is a
		// real page belonging to a different origin, not something we render
		// ourselves.
		onNotification(connection, openUrlNotification, openUrlParamsSchema, ({ url }) => {
			window.location.href = url;
		});
		connection.listen();

		connectRemoteSession(page.params.token ?? null, {
			// session.ts's callback type is a plain object — cast to
			// vscode-jsonrpc's Message, since every message on this channel is
			// now always a real JSON-RPC frame the TV's connection produced.
			onMessage: (message) => reader.push(message as unknown as Message),
			onClose: () => (connected = false)
		})
			.then((result) => {
				if (cancelled) return;
				if (!result) {
					phase = 'not-paired';
					return;
				}
				session = result;
				connected = true;
				phase = 'ready';
				connection?.sendNotification(requestStateNotification);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				errorMessage = err instanceof Error ? err.message : String(err);
				phase = 'error';
			});

		return () => {
			cancelled = true;
			connection?.dispose();
			session?.close();
			window.visualViewport?.removeEventListener('resize', updateKeyboardState);
		};
	});
</script>

<svelte:head>
	<title>{m.remote_title()}</title>
	<link rel="manifest" href="/remote/manifest.webmanifest" />
	<meta name="theme-color" content="#020617" />
	<link rel="apple-touch-icon" href="/remote/apple-touch-icon.png" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content={m.remote_title()} />
</svelte:head>

{#snippet readyHeader()}
	<header class="grid grid-cols-3 items-center px-4 pt-4 pb-2">
		<div class="justify-self-start">
			{#if canGoBack}
				<button
					type="button"
					onclick={goBack}
					transition:fade={{ duration: 200 }}
					class="rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
				>
					&larr; {m.back()}
				</button>
			{/if}
		</div>
		{#if canGoHome}
			<button
				type="button"
				onclick={goHome}
				aria-label={m.home()}
				transition:fade={{ duration: 200 }}
				class="justify-self-center rounded-full bg-white/12 p-3 text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="size-5"
				>
					<path d="M3 10.5 12 3l9 7.5" />
					<path d="M5.5 9.5V20a1 1 0 0 0 1 1h4v-6h3v6h4a1 1 0 0 0 1-1V9.5" />
				</svg>
			</button>
		{/if}
		<span class="flex items-center gap-2 justify-self-end text-xs text-white/50">
			<span class="size-2 rounded-full {connected ? 'bg-emerald-400' : 'bg-white/30'}"></span>
			{connected ? m.connected() : m.connecting()}
		</span>
	</header>
{/snippet}

{#snippet trackpadTab()}
	<div
		role="application"
		aria-label={m.trackpad_label()}
		ontouchstart={onTouchStart}
		ontouchmove={onTouchMove}
		ontouchend={onTouchEnd}
		style:view-transition-name="phone-trackpad"
		class="flex size-full max-h-96 w-full max-w-sm touch-none items-center justify-center rounded-3xl bg-white/12 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 select-none"
	>
		<p class="px-8 text-center text-sm text-white/40">{m.swipe_hint()}</p>
	</div>
{/snippet}

{#snippet keyboardTab()}
	<form onsubmit={onTextSubmit} class="flex w-full max-w-sm flex-col items-center gap-3">
		<input
			bind:this={textInput}
			bind:value={text}
			oninput={onTextInput}
			enterkeyhint="go"
			placeholder={m.type_here_placeholder()}
			class="w-full rounded-full bg-white/12 px-6 py-4 text-center text-lg text-white placeholder-white/40 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 focus:outline-none"
		/>
		<button
			type="submit"
			aria-label={m.enter()}
			class="w-full rounded-full bg-white px-6 py-4 text-lg font-medium text-slate-950 transition hover:bg-white/90 focus:outline-none"
		>
			{m.enter()}
		</button>
	</form>
{/snippet}

{#snippet profilesTab()}
	<div class="flex w-full max-w-sm flex-wrap items-start justify-center gap-x-6 gap-y-5">
		{#each profiles as profile, i (profile.id)}
			<button
				type="button"
				onclick={() => selectProfile(profile.id)}
				in:fly|global={{ y: 24, duration: 400, delay: i * 70 }}
				class="flex w-20 flex-col items-center gap-2 focus:outline-none"
			>
				<span
					class="flex size-16 items-center justify-center overflow-hidden rounded-full"
					style="background: {profileGradient(profile.username || profile.id)}"
				>
					{#if profile.image}
						<img src={profile.image} alt="" class="size-full object-cover" />
					{:else}
						<span class="text-xl font-semibold text-white/90 uppercase">
							{profile.username.slice(0, 1)}
						</span>
					{/if}
				</span>
				<span class="max-w-full truncate text-sm font-medium text-white/90">
					{profile.username}
				</span>
			</button>
		{/each}
	</div>
{/snippet}

{#snippet appShortcuts()}
	{#if apps.length > 0}
		<div class="mb-4 flex w-full max-w-sm justify-center gap-4" transition:fade={{ duration: 200 }}>
			{#each apps as app, i (app.id)}
				<button
					type="button"
					onclick={() => selectApp(app.id)}
					in:fly|global={{ y: 24, duration: 400, delay: i * 70 }}
					class="flex w-20 flex-col items-center gap-2 focus:outline-none"
				>
					<span
						class="flex size-14 items-center justify-center rounded-2xl text-lg font-semibold text-white/90 uppercase"
						style="background: {profileGradient(app.id)}"
					>
						{app.name.slice(0, 1)}
					</span>
					<span class="max-w-full truncate text-xs font-medium text-white/70">{app.name}</span>
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet playerTab()}
	<div class="flex w-full max-w-sm flex-col items-center gap-6">
		<div
			class="flex items-center justify-center gap-4"
			in:fly|global={{ y: 24, duration: 400, delay: 0 }}
		>
			<button
				type="button"
				onclick={() => playerAction('seekBack')}
				aria-label={m.seek_back()}
				class="flex size-16 items-center justify-center rounded-full bg-white/12 text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
			>
				<RotateCcw class="size-6" />
			</button>
			<button
				type="button"
				onclick={() => playerAction('playPause')}
				aria-label={m.play_pause()}
				class="flex size-20 items-center justify-center rounded-full bg-white text-slate-950 shadow-lg transition hover:bg-white/90 focus:outline-none"
			>
				{#if playing}
					<Pause class="size-8" fill="currentColor" />
				{:else}
					<Play class="size-8" fill="currentColor" />
				{/if}
			</button>
			<button
				type="button"
				onclick={() => playerAction('seekForward')}
				aria-label={m.seek_forward()}
				class="flex size-16 items-center justify-center rounded-full bg-white/12 text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
			>
				<RotateCw class="size-6" />
			</button>
		</div>

		<div class="flex w-full items-center gap-3" in:fly|global={{ y: 24, duration: 400, delay: 70 }}>
			<Volume2 class="size-5 shrink-0 text-white/60" aria-hidden="true" />
			<!-- The default ('md') size -- deliberately thicker than the seek
			     bar below it, since volume is the control most worth hitting
			     without looking. -->
			<Slider
				bind:value={scrubVolume}
				liveValue={volume}
				onChange={setVolume}
				min={0}
				max={1}
				step={0.02}
				orientation="horizontal"
				label={m.volume()}
			/>
		</div>

		<div
			class="flex w-full items-center gap-3"
			in:fly|global={{ y: 24, duration: 400, delay: 140 }}
		>
			<span class="w-10 text-right text-xs text-white/60 tabular-nums">
				{formatTime(scrubPosition)}
			</span>
			<Slider
				bind:value={scrubPosition}
				liveValue={position}
				onCommit={seekPlayer}
				min={0}
				max={duration}
				step={1}
				orientation="horizontal"
				label={m.seek()}
				sensitivity={1500}
				size="sm"
			/>
			<span class="w-10 text-xs text-white/60 tabular-nums">{formatTime(duration)}</span>
		</div>

		{#if qualityOptions.length > 0}
			<div
				class="flex flex-col items-center gap-2"
				in:fly|global={{ y: 24, duration: 400, delay: 210 }}
			>
				<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
					<Gauge class="size-4" />
					{m.quality()}
				</span>
				<!-- A collapsed Select rather than every option laid out flat,
				     same as the TV player's own quality picker -- a phone's
				     width runs out well before a long option list does. -->
				<Select
					value={quality}
					onChange={selectQuality}
					options={qualityChoices}
					label={m.quality()}
					option={qualityOption}
				/>
			</div>
		{/if}

		<!-- Only once the TV has actually reported tracks -- most sessions have
		     none, and an "Off"-only picker would be noise for no real choice
		     (same rule the TV player's own picker follows). -->
		{#if subtitleTracks.length > 0}
			<div
				class="flex flex-col items-center gap-2"
				in:fly|global={{ y: 24, duration: 400, delay: 245 }}
			>
				<span class="flex items-center gap-1.5 text-xs font-medium text-white/50">
					<Captions class="size-4" />
					{m.subtitles()}
				</span>
				<Select
					value={subtitleLanguage}
					onChange={selectSubtitle}
					options={subtitleChoices}
					label={m.subtitles()}
					option={subtitleOption}
				/>
			</div>
		{/if}

		<button
			type="button"
			onclick={() => playerAction('toggleInfo')}
			aria-label={m.info()}
			aria-pressed={diagnosticsOpen}
			in:fly|global={{ y: 24, duration: 400, delay: 280 }}
			class="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium shadow-lg ring-1 shadow-black/20 backdrop-blur-2xl backdrop-saturate-150 transition focus:outline-none {diagnosticsOpen
				? 'bg-white text-slate-950'
				: 'bg-white/12 text-white/80 ring-white/25 hover:bg-white/20'}"
		>
			<Info class="size-4" />
			{m.info()}
		</button>
	</div>
{/snippet}

<!-- Content for one quality option/trigger -- `onLight` is whether this
     particular rendering sits on the expanded list's solid white selected-row
     background rather than the trigger/other rows' dark translucent one (see
     Select.svelte), which the mode icon needs for contrast. -->
{#snippet qualityOption(option: number, onLight: boolean)}
	{@const mode = qualityModes[String(option)]}
	{@const ModeIcon = mode && QUALITY_MODE_ICON[mode]}
	<span>{option}p</span>
	{#if ModeIcon}
		<ModeIcon class="size-3.5 shrink-0 {onLight ? 'text-slate-950/70' : 'text-white/50'}" />
	{/if}
{/snippet}

{#snippet subtitleOption(language: string | null, onLight: boolean)}
	{@const track = subtitleTracks.find((t) => t.language === language) ?? null}
	<span class="min-w-0 truncate">
		{track ? (track.label ?? track.language) : m.subtitles_off()}
	</span>
	{#if track?.kind === 'transcription'}
		<Sparkles class="size-3.5 shrink-0 {onLight ? 'text-amber-600' : 'text-amber-400'}" />
	{/if}
{/snippet}

{#snippet trackpadToggle()}
	{#if requiredTab !== 'trackpad'}
		<button
			type="button"
			onclick={toggleTrackpad}
			aria-label={toggleLabel}
			style="bottom: calc(1.5rem + {keyboardInset}px)"
			transition:scale={{ duration: 200, start: 0.7 }}
			class="fixed right-6 z-10 rounded-full bg-white/12 p-4 text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
		>
			<ToggleIcon class="size-6" aria-hidden="true" />
		</button>
	{/if}
{/snippet}

{#snippet readyMain()}
	<main
		class="flex flex-1 flex-col items-center justify-center px-6 transition-transform duration-300 ease-out"
		style="transform: translateY(-{displayedTab === 'keyboard' ? keyboardInset / 2 : 0}px)"
	>
		{#if displayedTab === 'trackpad'}
			{@render appShortcuts()}
			{@render trackpadTab()}
		{:else if displayedTab === 'pin'}
			<PinPad bind:value={pin} onkey={onPinKey} oncomplete={onPinComplete} />
		{:else if displayedTab === 'profiles'}
			{@render profilesTab()}
		{:else if displayedTab === 'player'}
			{@render playerTab()}
		{:else}
			{@render keyboardTab()}
		{/if}
	</main>
{/snippet}

<div
	class="flex h-dvh flex-col bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 text-white"
>
	{#if phase === 'ready'}
		{@render readyHeader()}
		{@render readyMain()}
		{@render trackpadToggle()}
	{:else if phase === 'connecting'}
		<main class="flex flex-1 flex-col items-center justify-center px-8 text-center">
			<p class="text-white/60">{m.connecting()}</p>
		</main>
	{:else if phase === 'not-paired'}
		<main class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
			<p class="text-lg font-medium text-white/90">{m.not_paired_title()}</p>
			<p class="max-w-xs text-sm text-white/50">{m.not_paired_description()}</p>
		</main>
	{:else}
		<main class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
			<p class="text-lg font-medium text-white/90">{m.pairing_error_title()}</p>
			<p class="max-w-xs text-sm text-white/50">{errorMessage}</p>
		</main>
	{/if}
</div>
