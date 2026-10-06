<script lang="ts">
	import { onMount } from 'svelte';
	import { Smartphone, Unplug } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	// The bare package, as Vite can't resolve its conditional subpaths for a
	// component in both the server and browser build (see rpcRal.ts).
	// ensureRal() installs what those subpaths would have.
	import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc';
	import { afterNavigate, goto } from '$app/navigation';
	import { PAIRING_WS_PORT } from '#lib/wsConfig';
	import type { TvHello } from '#lib/pairing/protocol';
	import { ensureRal } from '#lib/rpcRal';
	import { createReconnector } from '#lib/pairing/reconnect';
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
	import { isTextualInput, requestTextExit, setInputValue, submitInput } from '#lib/textEntry';
	import { dismissKeyboard, keyboardVisible, osk } from '#lib/state/osk.svelte';

	// Lives in the root layout and connects the TV page to the paired phone
	// through the local relay. It turns the phone's gestures into focus moves,
	// clicks and typing, and reports what is on screen so the phone only shows
	// controls that apply.
	let socket: WebSocket | undefined;
	let connection: MessageConnection | undefined;
	let currentEl: HTMLElement | null = null;

	// Fixed, as the remote has one finger and the id is never one the browser tracks.
	const REMOTE_POINTER_ID = -1;

	// `data-focus-ring-target` lets a part, like a round avatar inside a wider
	// link, carry the ring instead of the focused element.
	function focusRingTarget(): HTMLElement | null {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || active === document.body) return null;
		return active.querySelector<HTMLElement>('[data-focus-ring-target]') ?? active;
	}

	// Keeps the `.pivi-remote-focus` ring on whatever holds focus, however it
	// got there, and re-announces state. Also runs after DOM mutations, since a
	// swapped form step drops focus to <body> without any focusin.
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

	// The field may have been removed while the keyboard still points at it.
	function connectedOskTarget() {
		return osk.target?.isConnected ? osk.target : null;
	}

	// Follows plain DOM focus instead of a marker attribute, so any <input>
	// gets phone keyboard support without extra wiring.
	function textState() {
		const el = focusedTextInput();
		return { hasTextInput: !!el, textValue: el?.value ?? '' };
	}

	function playerState() {
		const playerEl = document.querySelector<HTMLElement>('[data-pivi-player]');
		const playerVideo = playerEl?.querySelector<HTMLVideoElement>('video');
		return {
			hasPlayer: !!playerEl,
			playing: !!playerVideo && !playerVideo.paused,
			...playerProgress(playerEl)
		};
	}

	// Lets the phone show only the controls that apply to this screen.
	function sendState() {
		if (!connection) return;
		sendNotification(connection, stateNotification, stateParamsSchema, {
			hasPinPad: !!document.querySelector('[data-pivi-pinpad]'),
			...textState(),
			suggestions: focusedSuggestions(),
			...navigationFlagsFor(location.pathname),
			profiles: pickerProfiles(),
			// Capped here so the phone just renders what it gets.
			apps: dashboardApps().slice(0, 3),
			...playerState()
		});
	}

	// The schema needs these even without a player, the phone ignores them then.
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

	// An attribute caught mid-render falls back, the next push carries the real value.
	function jsonAttr<T>(value: string | undefined, fallback: T): T {
		try {
			return value ? JSON.parse(value) : fallback;
		} catch {
			return fallback;
		}
	}

	// Read from `data-pivi-player-*` attributes, so this layout component
	// doesn't need to know how the player computes them.
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
			// Attributes can't hold null, so the player writes "" for subtitles off.
			subtitleLanguage: data.piviPlayerSubtitleLanguage || null,
			diagnosticsOpen: data.piviPlayerDiagnosticsOpen === 'true',
			volume: numberAttr(data.piviPlayerVolume)
		};
	}

	// Read from the profile picker's `data-pivi-profile-*` attributes, as the
	// root layout shouldn't know that page's query.
	function pickerProfiles() {
		return [...document.querySelectorAll<HTMLElement>('[data-pivi-profile-id]')].map((el) => ({
			id: el.dataset.piviProfileId!,
			username: el.dataset.piviProfileUsername!,
			image: el.dataset.piviProfileImage || null
		}));
	}

	// Same for the dashboard's AppCards, so the phone can launch apps.
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

	// An armed slider takes swipes along its own axis as `pivi-slider-adjust`.
	// Returns false for off-axis swipes, so focus moves on like with any control.
	function trySliderAdjust(active: HTMLElement, dx: number, dy: number): boolean {
		const horizontal = active.getAttribute('data-pivi-slider-orientation') !== 'vertical';
		const isHorizontalSwipe = Math.abs(dx) > Math.abs(dy);
		if (horizontal !== isHorizontalSwipe) return false;
		const delta = horizontal ? dx : -dy;
		active.dispatchEvent(new CustomEvent('pivi-slider-adjust', { detail: { delta } }));
		return true;
	}

	// Unarmed sliders let swipes pass, so moving past one doesn't nudge it.
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
		// Safari jumps on focus regardless of `scroll-behavior`, so scroll
		// smoothly first and focus without scrolling.
		scrollFocusedIntoView(el, els);
		el.focus({ preventScroll: true });
	}

	// Picks the nearest focusable in the swipe direction, as a tab order doesn't
	// match a 2D TV layout (see spatialNav.ts).
	function moveFocus(dx: number, dy: number) {
		const els = focusableElements();
		const move = planMove(els, document.activeElement, dx, dy);
		if (!move) return;
		playSound('move');
		if (move.scroll) focusAndScroll(move.el, els);
		else move.el.focus();
	}

	// Centers the focused row, browser clamping handles the page ends. `nearest`
	// felt stuck, leaving the enlarged shelf title just offscreen.
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

	// By hand, as `scrollIntoView` would also scroll the window and undo the
	// vertical centering.
	function nudgeShelf(shelf: HTMLElement, el: HTMLElement) {
		const shelfRect = shelf.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		if (elRect.left < shelfRect.left) {
			shelf.scrollBy({ left: elRect.left - shelfRect.left, behavior: 'smooth' });
		} else if (elRect.right > shelfRect.right) {
			shelf.scrollBy({ left: elRect.right - shelfRect.right, behavior: 'smooth' });
		}
	}

	// The first and last card scroll the shelf fully. `nearest` stops short,
	// so the shelf seems to refuse to finish.
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

	// Sound and `.pivi-press` feedback for taps, mouse and the remote's select
	// alike, since they all end in a DOM click.
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

	// A real down and up with time between is what lets HoldToConfirmButton
	// work over the remote. Script pointer events never fire a click, so the
	// release handler clicks on its own.
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

	// Not a .click(), so PinPad skips its key flash and nobody can read a
	// phone-typed PIN off the TV.
	function pressPinKey(key: string) {
		document
			.querySelector('[data-pivi-pinpad]')
			?.dispatchEvent(new CustomEvent('pivi-remote-press', { detail: { key } }));
	}

	// Only the focused field's own suggestions, not another field's leftovers.
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

	// The phone has no Escape key. Blur covers fields that ignore the exit event.
	function exitFocusedText() {
		const el = focusedTextInput();
		if (!el) return;
		requestTextExit(el);
		if (el.isConnected && document.activeElement === el) el.blur();
		osk.target = null;
		scheduleFocusRecheck();
	}

	onMount(() => {
		document.addEventListener('focusin', onFocusChange);
		// Typing on the TV itself changes no DOM, but the phone must follow it.
		document.addEventListener('input', scheduleFocusRecheck);
		document.addEventListener('click', onClick);
		// Media events don't bubble, so only capture sees the <video>'s.
		document.addEventListener('play', scheduleFocusRecheck, true);
		document.addEventListener('pause', scheduleFocusRecheck, true);
		// Keeps the phone's progress bar moving during playback.
		document.addEventListener('timeupdate', scheduleFocusRecheck, true);
		// Keeps the phone's volume slider in sync with changes made on the TV.
		document.addEventListener('volumechange', scheduleFocusRecheck, true);
		// For player changes with no DOM mutation, like a quality auto-pick or
		// the TV's Info button.
		document.addEventListener('pivi-player-state-changed', scheduleFocusRecheck);

		const observer = new MutationObserver(scheduleFocusRecheck);
		observer.observe(document.body, { childList: true, subtree: true });

		ensureRal();

		const reader = new PushMessageReader();
		// Sending before the handshake finishes throws, and a focusin can trigger
		// that during mount. Dropping is fine, a later state push follows.
		const writer = new SinkMessageWriter((msg) => {
			if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
		});
		connection = createMessageConnection(reader, writer);

		onNotification(connection, moveNotification, moveParamsSchema, ({ dx, dy }) =>
			handleMove(dx, dy)
		);
		// No params, so there is no schema to validate.
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
		// The press turned into a swipe, so undo the pointerdown without the
		// click that would select whatever is focused.
		connection.onNotification(selectCancelNotification, () => {
			if (document.activeElement instanceof HTMLElement) {
				dispatchRemotePointer('pointercancel', document.activeElement);
			}
		});
		// Clicking the link instead of navigating keeps its view transition and
		// press feedback.
		onNotification(connection, selectProfileNotification, selectProfileParamsSchema, ({ id }) => {
			document.querySelector<HTMLElement>(`[data-pivi-profile-id="${CSS.escape(id)}"]`)?.click();
		});
		onNotification(connection, selectAppNotification, selectAppParamsSchema, ({ id }) => {
			document.querySelector<HTMLElement>(`[data-pivi-app-id="${CSS.escape(id)}"]`)?.click();
		});
		// A DOM event, as a volume nudge has no single element to click.
		onNotification(connection, playerActionNotification, playerActionParamsSchema, ({ action }) => {
			document.dispatchEvent(new CustomEvent('pivi-player-action', { detail: { action } }));
		});
		// Same handoff, carrying the value the player page needs.
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

		// The relay lives in the server process, so a server restart drops this
		// socket. Without a retry the TV stays deaf to the phone until a reload.
		const reconnector = createReconnector(openSocket);

		function openSocket() {
			const ws = new WebSocket(`ws://${location.hostname}:${PAIRING_WS_PORT}`);
			socket = ws;

			ws.onopen = () => {
				reconnector.connected();
				// Raw frame, not RPC. The relay only accepts it from loopback.
				ws.send(JSON.stringify({ type: 'tvHello' } satisfies TvHello));
				sendState();
			};

			ws.onmessage = (event) => {
				try {
					reader.push(JSON.parse(event.data));
				} catch {
					// Malformed frame, drop it rather than crash the connection.
				}
			};

			// Failed attempts end up here too, so this also drives the backoff.
			ws.onclose = () => {
				// No socket means no phone. The phone resends its mode once the TV
				// reports a focused text field again.
				osk.phoneKeyboard = false;
				reconnector.lost();
			};
		}

		openSocket();

		return () => {
			document.removeEventListener('focusin', onFocusChange);
			document.removeEventListener('click', onClick);
			document.removeEventListener('play', scheduleFocusRecheck, true);
			document.removeEventListener('pause', scheduleFocusRecheck, true);
			document.removeEventListener('timeupdate', scheduleFocusRecheck, true);
			document.removeEventListener('volumechange', scheduleFocusRecheck, true);
			document.removeEventListener('pivi-player-state-changed', scheduleFocusRecheck);
			observer.disconnect();
			reconnector.stop();
			connection?.dispose();
			socket?.close();
		};
	});

	// This component survives navigation, so it refreshes the ring and state itself.
	afterNavigate(() => {
		// A focused layout element, like the profile chip, survives too, so its
		// ring has to be removed explicitly.
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
