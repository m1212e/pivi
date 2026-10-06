<script lang="ts">
	import { onMount } from 'svelte';
	import { Smartphone, Unplug } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	// The bare package, not a /node or /browser subpath — see rpcRal.ts for
	// why (Vite can't consistently resolve those conditional-only exports
	// for a component that's reachable from both a server and browser
	// build). ensureRal() below installs the RAL createMessageConnection
	// needs, which those subpaths would otherwise have done as a side
	// effect of importing them.
	import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc';
	import { afterNavigate, goto } from '$app/navigation';
	import { PAIRING_WS_PORT } from '#lib/wsConfig';
	import type { TvHello } from '#lib/pairing/protocol';
	import { ensureRal } from '#lib/rpcRal';
	import { PushMessageReader, SinkMessageWriter } from '#lib/rpcTransport';
	import {
		backNotification,
		goHomeNotification,
		enterNotification,
		suggestionNotification,
		suggestionParamsSchema,
		exitTextNotification,
		keyNotification,
		keyParamsSchema,
		moveNotification,
		moveParamsSchema,
		playerActionNotification,
		playerActionParamsSchema,
		playerQualityNotification,
		playerQualityParamsSchema,
		playerSubtitleNotification,
		playerSubtitleParamsSchema,
		playerSeekNotification,
		playerSeekParamsSchema,
		playerVolumeNotification,
		playerVolumeParamsSchema,
		remoteConnectedNotification,
		remoteDeviceParamsSchema,
		remoteDisconnectedNotification,
		requestStateNotification,
		selectAppNotification,
		selectAppParamsSchema,
		selectCancelNotification,
		selectPressNotification,
		selectReleaseNotification,
		selectProfileNotification,
		selectProfileParamsSchema,
		stateNotification,
		stateParamsSchema,
		textEntryModeNotification,
		textEntryModeParamsSchema,
		textNotification,
		textParamsSchema
	} from '#lib/pairing/remoteProtocol';
	import { onNotification, sendNotification } from '#lib/rpc';
	import * as m from '#lib/paraglide/messages';
	import { playSound } from '#lib/sounds';
	import { navigationFlagsFor } from '#lib/navigationFlags';
	import { planMove } from '#lib/spatialNav';
	import { isTextualInput, setInputValue, submitInput } from '#lib/textEntry';
	import { dismissKeyboard, keyboardVisible, osk } from '#lib/state/osk.svelte';

	let socket: WebSocket | undefined;
	let connection: MessageConnection | undefined;
	let currentEl: HTMLElement | null = null;

	// Arbitrary and fixed: the remote only ever has one "finger" down at a
	// time, and this never corresponds to a pointer the browser's own input
	// pipeline tracks (see dispatchRemotePointer below), so there's nothing
	// for it to collide with.
	const REMOTE_POINTER_ID = -1;

	// Keeps the explicit selection ring in sync with whatever actually holds
	// focus, regardless of how it got there (remote swipe, direct tap, Tab
	// key) — see the `.pivi-remote-focus` comment in layout.css. Also
	// re-announces state, since moving onto/off a text field changes
	// `hasTextInput` without a page navigation. Called both on real focus
	// events and after DOM mutations (see the MutationObserver below), since
	// a step of a form can swap out the focused element entirely — the focus
	// silently drops to <body> with no `focusin` to react to.
	// A focusable element (e.g. a profile link) can opt a specific descendant
	// in to carry the visible ring instead of itself — say, a circular avatar
	// inside a wider rectangular link — via `data-focus-ring-target`. Falls
	// back to the focused element itself, and to nothing at all when focus has
	// dropped to <body>.
	function focusRingTarget(): HTMLElement | null {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || active === document.body) return null;
		return active.querySelector<HTMLElement>('[data-focus-ring-target]') ?? active;
	}

	function onFocusChange() {
		const next = focusRingTarget();
		if (next !== currentEl) {
			currentEl?.classList.remove('pivi-remote-focus');
			currentEl = next;
			currentEl?.classList.add('pivi-remote-focus');
		}
		sendState();
	}

	// Coalesces bursts of DOM mutations (e.g. a whole step of a form being
	// swapped out) into a single re-check per task.
	let recheckScheduled = false;
	function scheduleFocusRecheck() {
		if (recheckScheduled) return;
		recheckScheduled = true;
		queueMicrotask(() => {
			recheckScheduled = false;
			onFocusChange();
		});
	}

	// While focus sits on the on-screen keyboard's keys, the field being typed
	// into is still the one the phone should mirror.
	function focusedTextInput() {
		const active = document.activeElement;
		if (isTextualInput(active)) return active;
		return active?.closest('[data-pivi-osk]') ? connectedOskTarget() : null;
	}

	function connectedOskTarget() {
		return osk.target?.isConnected ? osk.target : null;
	}

	// Tells the phone what's actually on screen right now, so it only shows
	// the PIN pad, keyboard, or back button when there's something for them
	// to do here. Text-field targeting rides on plain DOM focus, the same
	// thing a screen reader or a real keyboard already keys off, instead of
	// a bespoke marker attribute, so any future page with a normal <input>
	// gets remote-keyboard support with no extra wiring.
	function textState() {
		const el = focusedTextInput();
		return { hasTextInput: !!el, textValue: el?.value ?? '' };
	}

	// `playing`/position/duration/quality are only meaningful alongside
	// `hasPlayer` anyway (no player, no video to report on).
	function playerState() {
		const playerEl = document.querySelector<HTMLElement>('[data-pivi-player]');
		const playerVideo = playerEl?.querySelector<HTMLVideoElement>('video');
		return {
			hasPlayer: !!playerEl,
			playing: !!playerVideo && !playerVideo.paused,
			...playerProgress(playerEl)
		};
	}

	function sendState() {
		if (!connection) return;
		sendNotification(connection, stateNotification, stateParamsSchema, {
			hasPinPad: !!document.querySelector('[data-pivi-pinpad]'),
			...textState(),
			suggestions: focusedSuggestions(),
			...navigationFlagsFor(location.pathname),
			profiles: pickerProfiles(),
			// Sliced to the first three here (rather than trusting the phone
			// to do it) so the phone doesn't need to know that limit is even a
			// thing, it just renders whatever this sends.
			apps: dashboardApps().slice(0, 3),
			...playerState()
		});
	}

	// What the player's own state fields are when there's no player at all --
	// the schema requires them regardless of `hasPlayer`, and the phone
	// ignores them in that case.
	const NO_PLAYER_PROGRESS = {
		position: 0,
		duration: 0,
		quality: 0,
		qualityOptions: [] as number[],
		qualityModes: {} as Record<string, 'direct' | 'mse' | 'ffmpeg'>,
		subtitleTracks: [] as {
			language: string;
			label: string | null;
			kind: 'caption' | 'transcription';
		}[],
		subtitleLanguage: null as string | null,
		diagnosticsOpen: false,
		volume: 0
	};

	function numberAttr(value: string | undefined): number {
		return Number(value) || 0;
	}

	function numberListAttr(value: string | undefined): number[] {
		return (value ?? '').split(',').filter(Boolean).map(Number);
	}

	// A malformed/stale attribute caught mid-render falls back rather than
	// crashing the whole state push -- the next one (they're frequent) carries
	// the real value.
	function jsonAttr<T>(value: string | undefined, fallback: T): T {
		try {
			return value ? JSON.parse(value) : fallback;
		} catch {
			return fallback;
		}
	}

	// The player page's own position/quality/subtitle/diagnostics state,
	// straight off `data-pivi-player-*` attributes (same idea as
	// pickerProfiles/dashboardApps below) -- this component has no business
	// knowing how the player itself computes any of these.
	function playerProgress(playerEl: HTMLElement | null) {
		if (!playerEl) return { ...NO_PLAYER_PROGRESS };
		const data = playerEl.dataset;
		return {
			position: numberAttr(data.piviPlayerPosition),
			duration: numberAttr(data.piviPlayerDuration),
			quality: numberAttr(data.piviPlayerQuality),
			qualityOptions: numberListAttr(data.piviPlayerQualityOptions),
			qualityModes: jsonAttr(data.piviPlayerQualityModes, NO_PLAYER_PROGRESS.qualityModes),
			subtitleTracks: jsonAttr(data.piviPlayerSubtitleTracks, NO_PLAYER_PROGRESS.subtitleTracks),
			// The empty attribute value is how the player page writes "off"
			// (an attribute can't carry null), so it maps back to null here
			// rather than to an empty-string language nothing would match.
			subtitleLanguage: data.piviPlayerSubtitleLanguage || null,
			diagnosticsOpen: data.piviPlayerDiagnosticsOpen === 'true',
			volume: numberAttr(data.piviPlayerVolume)
		};
	}

	// The pre-login picker's own profiles, read straight from its DOM (see
	// `+page.svelte`'s `data-pivi-profile-*` attributes) rather than
	// re-querying them -- this component lives in the root layout and has no
	// business knowing about that page's own GraphQL query.
	function pickerProfiles() {
		return [...document.querySelectorAll<HTMLElement>('[data-pivi-profile-id]')].map((el) => ({
			id: el.dataset.piviProfileId!,
			username: el.dataset.piviProfileUsername!,
			image: el.dataset.piviProfileImage || null
		}));
	}

	// The home dashboard's own app shortcuts, same idea (see
	// AppCard.svelte's `data-pivi-app-*` attributes).
	function dashboardApps() {
		return [...document.querySelectorAll<HTMLElement>('[data-pivi-app-id]')].map((el) => ({
			id: el.dataset.piviAppId!,
			name: el.dataset.piviAppName!,
			icon: el.dataset.piviAppIcon ?? null,
			primaryColor: el.dataset.piviAppPrimaryColor ?? null,
			secondaryColor: el.dataset.piviAppSecondaryColor ?? null
		}));
	}

	function focusableElements() {
		const all = [
			...document.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		].filter((el) => el.offsetParent !== null || el.checkVisibility());
		// Focus stays on the keys while the keyboard is open, so a stray swipe
		// cannot land on the page behind it.
		return keyboardVisible() ? all.filter((el) => el.closest('[data-pivi-osk]')) : all;
	}

	// A slider (#lib/components/Slider.svelte) opts out of normal spatial nav
	// along its own axis while it holds focus -- a swipe matching its
	// orientation adjusts its value instead of moving focus (dispatched as a
	// plain DOM event, the same way pressPinKey/setFocusedText below drive
	// other on-screen controls rather than needing their own RPC messages);
	// a swipe across the other axis still falls through to moveFocus, so
	// swiping "off axis" carries focus away exactly like leaving any other
	// control.
	// Dispatches the swipe to the focused slider when its own axis matches the
	// swipe's dominant axis. Returns whether it did, so the caller falls
	// through to normal spatial-nav focus movement otherwise.
	function trySliderAdjust(active: HTMLElement, dx: number, dy: number): boolean {
		const horizontal = active.getAttribute('data-pivi-slider-orientation') !== 'vertical';
		const isHorizontalSwipe = Math.abs(dx) > Math.abs(dy);
		if (horizontal !== isHorizontalSwipe) return false;
		const delta = horizontal ? dx : -dy;
		active.dispatchEvent(new CustomEvent('pivi-slider-adjust', { detail: { delta } }));
		return true;
	}

	// Only an armed slider (a press already activated it -- see Slider.svelte)
	// claims a swipe; an unarmed one just sits there while swipes move focus
	// normally, so landing on one and continuing past it doesn't nudge its
	// value.
	function armedSlider(el: Element | null): HTMLElement | null {
		if (!(el instanceof HTMLElement) || !el.hasAttribute('data-pivi-slider')) return null;
		return el.getAttribute('data-pivi-slider-armed') === 'true' ? el : null;
	}

	function handleMove(dx: number, dy: number) {
		const slider = armedSlider(document.activeElement);
		if (slider && trySliderAdjust(slider, dx, dy)) return;
		moveFocus(dx, dy);
	}

	function focusAndScroll(el: HTMLElement, els: HTMLElement[]) {
		// Focus alone can jump instantly on some browsers regardless of the
		// container's `scroll-behavior` (Safari in particular), so scroll it
		// into view ourselves first and let focus land without re-scrolling.
		scrollFocusedIntoView(el, els);
		el.focus({ preventScroll: true });
	}

	// Lightweight spatial navigation: from the focused element, pick the
	// nearest other focusable element within a cone in the swipe direction,
	// rather than a fixed tab order (see spatialNav.ts).
	function moveFocus(dx: number, dy: number) {
		const els = focusableElements();
		const move = planMove(els, document.activeElement, dx, dy);
		if (!move) return;
		playSound('move');
		if (move.scroll) focusAndScroll(move.el, els);
		else move.el.focus();
	}

	// Vertically, center whichever row (title included) or the top bar holds
	// focus, and let the browser's own scroll clamping stop that short of the
	// top/bottom of the page -- which is exactly "center it, except near an
	// end". `scrollIntoView({block: 'nearest'})` instead reads as "stuck"
	// rather than "arrived": it's satisfied the instant a shelf's title (now
	// much larger while active) is still scrolled just off the top.
	function centerVertically(el: HTMLElement) {
		// A sticky sidebar is always on screen, so scrolling the page to center
		// it would only shove the content around.
		if (el.closest('[data-pivi-sticky]')) return;
		const target = el.closest<HTMLElement>('[data-pivi-row], [data-pivi-top-bar]') ?? el;
		const rect = target.getBoundingClientRect();
		const elementCenter = rect.top + rect.height / 2;
		window.scrollTo({
			top: window.scrollY + elementCenter - window.innerHeight / 2,
			behavior: 'smooth'
		});
	}

	// Any card moving out of frame just needs the shelf nudged enough to bring
	// it back in. Done by hand (not `el.scrollIntoView({block: 'nearest'})`)
	// because that also re-scrolls the window for the block axis -- undoing
	// the vertical centering above, since both target the same window scroll.
	function nudgeShelf(shelf: HTMLElement, el: HTMLElement) {
		const shelfRect = shelf.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		if (elRect.left < shelfRect.left) {
			shelf.scrollBy({ left: elRect.left - shelfRect.left, behavior: 'smooth' });
		} else if (elRect.right > shelfRect.right) {
			shelf.scrollBy({ left: elRect.right - shelfRect.right, behavior: 'smooth' });
		}
	}

	// The first/last card in a shelf scrolls that shelf to its actual limit
	// rather than just far enough to show the card -- `nearest` stops short of
	// the end, which reads as the shelf refusing to finish scrolling.
	function scrollShelf(shelf: HTMLElement, el: HTMLElement, focusable: HTMLElement[]) {
		const items = focusable.filter((candidate) => shelf.contains(candidate));
		if (el === items[0]) return shelf.scrollTo({ left: 0, behavior: 'smooth' });
		if (el === items.at(-1)) return shelf.scrollTo({ left: shelf.scrollWidth, behavior: 'smooth' });
		nudgeShelf(shelf, el);
	}

	function scrollFocusedIntoView(el: HTMLElement, focusable: HTMLElement[]) {
		centerVertically(el);
		const shelf = el.closest<HTMLElement>('[data-pivi-hscroll]');
		if (shelf) scrollShelf(shelf, el, focusable);
	}

	// Plays the `.pivi-press` scale animation on whatever was just clicked —
	// a real tap, a mouse click, or the remote's synthetic `select` click all
	// go through the same DOM `click` event, so one listener covers them all.
	function onClick(event: MouseEvent) {
		if (!(event.target instanceof HTMLElement)) return;
		const target = event.target.closest<HTMLElement>(
			'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
		if (!target) return;
		playSound('select');
		target.classList.remove('pivi-press');
		// Force a reflow so re-adding the class restarts the animation even if
		// it's clicked again before the previous run finished.
		void target.offsetWidth;
		target.classList.add('pivi-press');
	}

	// Gives whatever's focused a real pointerdown/pointerup with duration in
	// between (see selectPress/selectReleaseNotification below), rather than
	// the single synthetic click a remote press used to produce -- the only
	// thing that lets HoldToConfirmButton's hold-to-confirm gesture actually
	// run over the remote. A script-dispatched pointer event never auto-fires
	// a `click` afterward the way a trusted device one does, so the release
	// handler below still calls `.click()` itself for every other control
	// that only ever listens for clicks.
	function dispatchRemotePointer(
		type: 'pointerdown' | 'pointerup' | 'pointercancel',
		el: HTMLElement
	) {
		el.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				pointerId: REMOTE_POINTER_ID,
				pointerType: 'touch',
				isPrimary: true
			})
		);
	}

	function pressPinKey(key: string) {
		// Not a real .click() -- PinPad listens for this event specifically so
		// it can register the digit without its usual "which key was pressed"
		// flash, since that flash is meant for someone entering a PIN directly
		// on the TV, not for anyone nearby to read off a PIN typed on a phone.
		document
			.querySelector('[data-pivi-pinpad]')
			?.dispatchEvent(new CustomEvent('pivi-remote-press', { detail: { key } }));
	}

	function focusedSuggestions() {
		const el = focusedTextInput();
		return el && osk.suggestions.owner === el ? $state.snapshot(osk.suggestions.items) : [];
	}

	function pickFocusedSuggestion(value: string) {
		focusedTextInput()?.dispatchEvent(new CustomEvent('pivi-suggestion', { detail: value }));
	}

	// New suggestions arrive after the field gained focus, with no DOM change
	// the observer would notice.
	$effect(() => {
		void osk.suggestions.items;
		queueMicrotask(sendState);
	});

	function setFocusedText(value: string) {
		const el = focusedTextInput();
		if (el) setInputValue(el, value);
	}

	function submitFocusedText() {
		const el = focusedTextInput();
		if (el) submitInput(el);
	}

	function exitFocusedText() {
		const el = focusedTextInput();
		if (!el) return;
		// Fields that manage their own editing state close on Escape.
		el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		if (el.isConnected && document.activeElement === el) el.blur();
		osk.target = null;
		scheduleFocusRecheck();
	}

	onMount(() => {
		document.addEventListener('focusin', onFocusChange);
		// Typing on the TV itself changes no DOM, but the phone must follow it.
		document.addEventListener('input', scheduleFocusRecheck);
		document.addEventListener('click', onClick);
		// `play`/`pause` don't bubble, so a plain (bubbling) document listener
		// would never see them fire on the player's own <video> -- capture does,
		// since capturing listeners reach the target on the way down regardless
		// of whether the event goes on to bubble back up.
		document.addEventListener('play', scheduleFocusRecheck, true);
		document.addEventListener('pause', scheduleFocusRecheck, true);
		// `timeupdate` doesn't bubble either, same as play/pause -- keeps the
		// phone's progress bar advancing during playback instead of only
		// updating on the next unrelated state push.
		document.addEventListener('timeupdate', scheduleFocusRecheck, true);
		// `volumechange` doesn't bubble either -- keeps the phone's volume
		// slider in sync with a volume change made on the TV side itself
		// (its own slider, a remote's volume nudge already routed through
		// here) instead of only updating on the next unrelated state push.
		document.addEventListener('volumechange', scheduleFocusRecheck, true);
		// Dispatched by the player page itself (bubbles normally) whenever its
		// quality or diagnostics-panel state changes on its own, e.g. from a
		// quality auto-pick or the TV's own Info button -- neither shows up as
		// a DOM mutation the observer below would catch.
		document.addEventListener('pivi-player-state-changed', scheduleFocusRecheck);

		const observer = new MutationObserver(scheduleFocusRecheck);
		observer.observe(document.body, { childList: true, subtree: true });

		ensureRal();
		socket = new WebSocket(`ws://${location.hostname}:${PAIRING_WS_PORT}`);

		const reader = new PushMessageReader();
		// `socket?.` alone isn't enough of a guard -- calling `.send()` while
		// the handshake hasn't finished yet (readyState CONNECTING) throws
		// synchronously, and a focusin/mutation can fire sendState() that
		// early during initial mount, before `onopen` below has run. Silently
		// dropping the message when the socket isn't actually open yet
		// matches how every other send on this connection already behaves
		// best-effort (e.g. a phone that hasn't paired yet just never gets a
		// stateNotification, rather than crashing the tab that would send it).
		const writer = new SinkMessageWriter((msg) => {
			if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
		});
		connection = createMessageConnection(reader, writer);

		onNotification(connection, moveNotification, moveParamsSchema, ({ dx, dy }) =>
			handleMove(dx, dy)
		);
		// These carry no params, so there's nothing for a zod schema to
		// enforce — registered directly on the connection instead of through
		// the onNotification wrapper.
		connection.onNotification(selectPressNotification, () => {
			if (document.activeElement instanceof HTMLElement) {
				dispatchRemotePointer('pointerdown', document.activeElement);
			}
		});
		connection.onNotification(selectReleaseNotification, () => {
			if (document.activeElement instanceof HTMLElement) {
				const el = document.activeElement;
				dispatchRemotePointer('pointerup', el);
				el.click();
			}
		});
		// A press that turned out to be the start of a swipe, not a real
		// selection -- cancels whatever the pointerdown above started (e.g.
		// unwinds HoldToConfirmButton's hold back to empty) without the
		// release handler's `.click()`, which would otherwise fire a real
		// selection on whatever's focused just because a swipe began under it.
		connection.onNotification(selectCancelNotification, () => {
			if (document.activeElement instanceof HTMLElement) {
				dispatchRemotePointer('pointercancel', document.activeElement);
			}
		});
		// Clicking the matching profile link (rather than just navigating
		// directly) reuses its existing view-transition tagging and the
		// `.pivi-press` feedback animation above, same as every other
		// remote-driven interaction.
		onNotification(connection, selectProfileNotification, selectProfileParamsSchema, ({ id }) => {
			document.querySelector<HTMLElement>(`[data-pivi-profile-id="${CSS.escape(id)}"]`)?.click();
		});
		onNotification(connection, selectAppNotification, selectAppParamsSchema, ({ id }) => {
			document.querySelector<HTMLElement>(`[data-pivi-app-id="${CSS.escape(id)}"]`)?.click();
		});
		// A plain DOM event, not a click -- see remoteProtocol.ts's own comment
		// on why (no single element to click for a volume nudge).
		onNotification(connection, playerActionNotification, playerActionParamsSchema, ({ action }) => {
			document.dispatchEvent(new CustomEvent('pivi-player-action', { detail: { action } }));
		});
		// Same plain-DOM-event handoff as playerActionNotification above, just
		// carrying a value the player page needs (the seek target / picked
		// quality) rather than a fixed action name.
		onNotification(connection, playerSeekNotification, playerSeekParamsSchema, ({ seconds }) => {
			document.dispatchEvent(new CustomEvent('pivi-player-seek', { detail: { seconds } }));
		});
		onNotification(
			connection,
			playerQualityNotification,
			playerQualityParamsSchema,
			({ quality }) => {
				document.dispatchEvent(new CustomEvent('pivi-player-quality', { detail: { quality } }));
			}
		);
		onNotification(
			connection,
			playerSubtitleNotification,
			playerSubtitleParamsSchema,
			({ language }) => {
				document.dispatchEvent(new CustomEvent('pivi-player-subtitle', { detail: { language } }));
			}
		);
		onNotification(connection, playerVolumeNotification, playerVolumeParamsSchema, ({ volume }) => {
			document.dispatchEvent(new CustomEvent('pivi-player-volume', { detail: { volume } }));
		});
		// Back closes an open on-screen keyboard first, like on any TV.
		connection.onNotification(backNotification, () => {
			if (!dismissKeyboard()) history.back();
		});
		onNotification(connection, textEntryModeNotification, textEntryModeParamsSchema, (mode) => {
			osk.phoneKeyboard = mode.phoneKeyboard;
		});
		connection.onNotification(goHomeNotification, () => goto('/home'));
		onNotification(connection, keyNotification, keyParamsSchema, ({ value }) => pressPinKey(value));
		onNotification(connection, textNotification, textParamsSchema, ({ value }) =>
			setFocusedText(value)
		);
		onNotification(connection, suggestionNotification, suggestionParamsSchema, ({ value }) =>
			pickFocusedSuggestion(value)
		);
		connection.onNotification(enterNotification, () => submitFocusedText());
		connection.onNotification(exitTextNotification, () => exitFocusedText());
		connection.onNotification(requestStateNotification, () => sendState());
		onNotification(
			connection,
			remoteConnectedNotification,
			remoteDeviceParamsSchema,
			({ name }) => {
				showRemoteToast(() =>
					toast.success(m.remote_connected_toast({ name }), toastOptions(Smartphone))
				);
			}
		);
		onNotification(
			connection,
			remoteDisconnectedNotification,
			remoteDeviceParamsSchema,
			({ name }) => {
				osk.phoneKeyboard = false;
				showRemoteToast(() => toast(m.remote_disconnected_toast({ name }), toastOptions(Unplug)));
			}
		);
		connection.listen();

		socket.onopen = () => {
			// Only accepted from the relay's loopback check — this tab and the
			// relay run on the same device. See src/api/ws/relay.ts. Sent as a
			// raw frame, not through the RPC connection above — it's a
			// relay-level handshake message (see pairing/protocol.ts), not part
			// of the app-level remote-control protocol that starts afterwards.
			socket?.send(JSON.stringify({ type: 'tvHello' } satisfies TvHello));
			sendState();
		};

		socket.onmessage = (event) => {
			try {
				reader.push(JSON.parse(event.data));
			} catch {
				// Malformed frame — drop it rather than crash the connection.
			}
		};

		return () => {
			document.removeEventListener('focusin', onFocusChange);
			document.removeEventListener('click', onClick);
			document.removeEventListener('play', scheduleFocusRecheck, true);
			document.removeEventListener('pause', scheduleFocusRecheck, true);
			document.removeEventListener('timeupdate', scheduleFocusRecheck, true);
			document.removeEventListener('volumechange', scheduleFocusRecheck, true);
			document.removeEventListener('pivi-player-state-changed', scheduleFocusRecheck);
			observer.disconnect();
			connection?.dispose();
			socket?.close();
		};
	});

	// Re-announce state after every client-side navigation (this component
	// lives in the root layout, so it survives navigation between routes).
	// The previously-focused element is gone either way, so drop the ring
	// eagerly instead of waiting on a stray focusin that may never come.
	afterNavigate(() => {
		// If the focused element lives in the root layout (e.g. the profile
		// chip) rather than the page that just got swapped out, it survives
		// navigation — so its ring has to be removed explicitly, not just
		// dropped by nulling `currentEl`, or it's stuck there indefinitely.
		currentEl?.classList.remove('pivi-remote-focus');
		currentEl = null;
		queueMicrotask(sendState);
	});

	// Toasts are for a glance. Sonner pauses its own timer while the pointer
	// is over one, which on a TV can leave it covering the screen (the sign-in
	// QR code, say), so this dismisses on a hard timer and lets a newer
	// connect/disconnect toast replace the old one instead of stacking.
	const REMOTE_TOAST_ID = 'remote-status';
	const REMOTE_TOAST_MS = 3000;
	let remoteToastTimer: ReturnType<typeof setTimeout> | undefined;

	function toastOptions(icon: typeof Smartphone) {
		return { id: REMOTE_TOAST_ID, icon, duration: REMOTE_TOAST_MS };
	}

	function showRemoteToast(show: () => unknown) {
		show();
		clearTimeout(remoteToastTimer);
		remoteToastTimer = setTimeout(() => toast.dismiss(REMOTE_TOAST_ID), REMOTE_TOAST_MS);
	}
</script>
