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
		selectNotification,
		selectProfileNotification,
		selectProfileParamsSchema,
		stateNotification,
		stateParamsSchema,
		textNotification,
		textParamsSchema
	} from '#lib/pairing/remoteProtocol';
	import { onNotification, sendNotification } from '#lib/rpc';
	import * as m from '#lib/paraglide/messages';

	let socket: WebSocket | undefined;
	let connection: MessageConnection | undefined;
	let currentEl: HTMLElement | null = null;

	const TEXTUAL_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password']);

	// Keeps the explicit selection ring in sync with whatever actually holds
	// focus, regardless of how it got there (remote swipe, direct tap, Tab
	// key) — see the `.pivi-remote-focus` comment in layout.css. Also
	// re-announces state, since moving onto/off a text field changes
	// `hasTextInput` without a page navigation. Called both on real focus
	// events and after DOM mutations (see the MutationObserver below), since
	// a step of a form can swap out the focused element entirely — the focus
	// silently drops to <body> with no `focusin` to react to.
	function onFocusChange() {
		const active = document.activeElement;
		// A focusable element (e.g. a profile link) can opt a specific
		// descendant in to carry the visible ring instead of itself — say, a
		// circular avatar inside a wider rectangular link — via
		// `data-focus-ring-target`. Falls back to the focused element itself.
		const next =
			active instanceof HTMLElement && active !== document.body
				? (active.querySelector<HTMLElement>('[data-focus-ring-target]') ?? active)
				: null;
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

	function focusedTextInput() {
		const active = document.activeElement;
		if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement))
			return null;
		if (active instanceof HTMLInputElement && !TEXTUAL_INPUT_TYPES.has(active.type)) return null;
		return active;
	}

	// Tells the phone what's actually on screen right now, so it only shows
	// the PIN pad, keyboard, or back button when there's something for them
	// to do here. Text-field targeting rides on plain DOM focus — the same
	// thing a screen reader or a real keyboard already keys off — instead of
	// a bespoke marker attribute, so any future page with a normal <input>
	// gets remote-keyboard support with no extra wiring.
	function sendState() {
		if (!connection) return;
		// Queried once and reused below -- `playing`/position/duration/quality
		// are only ever meaningful alongside `hasPlayer` anyway (no player, no
		// video to report on).
		const playerEl = document.querySelector<HTMLElement>('[data-pivi-player]');
		const playerVideo = playerEl?.querySelector<HTMLVideoElement>('video');
		sendNotification(connection, stateNotification, stateParamsSchema, {
			hasPinPad: !!document.querySelector('[data-pivi-pinpad]'),
			hasTextInput: !!focusedTextInput(),
			// Neither the pre-login profile picker ('/') nor the home screen
			// itself has anywhere sensible to go back *to*.
			canGoBack: location.pathname !== '/' && location.pathname !== '/home',
			// Mirrors hooks.server.ts's own definition of "has an active
			// profile" for the routes that actually go somewhere Home would
			// usefully return from -- unlike canGoBack, this stays false on
			// '/home' itself, since Home is already where you are.
			canGoHome: location.pathname.startsWith('/apps/') || location.pathname.startsWith('/play/'),
			profiles: pickerProfiles(),
			// Sliced to the first three here (rather than trusting the phone
			// to do it) so the phone doesn't need to know that limit is even a
			// thing -- it just renders whatever this sends.
			apps: dashboardApps().slice(0, 3),
			hasPlayer: !!playerEl,
			playing: !!playerVideo && !playerVideo.paused,
			...playerProgress(playerEl)
		});
	}

	// The player page's own position/duration/quality/diagnostics state,
	// straight off `data-pivi-player-*` attributes (same idea as
	// pickerProfiles/dashboardApps below) -- this component has no business
	// knowing how the player itself computes any of these. Zeroed/emptied
	// when there's no player at all, since the schema requires them
	// regardless of `hasPlayer`.
	function playerProgress(playerEl: HTMLElement | null) {
		if (!playerEl) {
			return {
				position: 0,
				duration: 0,
				quality: 0,
				qualityOptions: [],
				qualityModes: {},
				subtitleTracks: [],
				subtitleLanguage: null,
				diagnosticsOpen: false,
				volume: 0
			};
		}
		let qualityModes: Record<string, 'direct' | 'mse' | 'ffmpeg'> = {};
		try {
			qualityModes = JSON.parse(playerEl.dataset.piviPlayerQualityModes ?? '{}');
		} catch {
			// Malformed/stale attribute mid-render -- fall back to no icons
			// rather than crashing this whole state push.
		}
		let subtitleTracks: {
			language: string;
			label: string | null;
			kind: 'caption' | 'transcription';
		}[] = [];
		try {
			subtitleTracks = JSON.parse(playerEl.dataset.piviPlayerSubtitleTracks ?? '[]');
		} catch {
			// Same as qualityModes above -- an empty list just means the phone
			// doesn't show the subtitle picker until the next state push.
		}
		return {
			position: Number(playerEl.dataset.piviPlayerPosition) || 0,
			duration: Number(playerEl.dataset.piviPlayerDuration) || 0,
			quality: Number(playerEl.dataset.piviPlayerQuality) || 0,
			qualityOptions: (playerEl.dataset.piviPlayerQualityOptions ?? '')
				.split(',')
				.filter(Boolean)
				.map(Number),
			qualityModes,
			subtitleTracks,
			// The empty attribute value is how the player page writes "off"
			// (an attribute can't carry null), so it maps back to null here
			// rather than to an empty-string language nothing would match.
			subtitleLanguage: playerEl.dataset.piviPlayerSubtitleLanguage || null,
			diagnosticsOpen: playerEl.dataset.piviPlayerDiagnosticsOpen === 'true',
			volume: Number(playerEl.dataset.piviPlayerVolume) || 0
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
			name: el.dataset.piviAppName!
		}));
	}

	function focusableElements() {
		return [
			...document.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		].filter((el) => el.offsetParent !== null);
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

	function handleMove(dx: number, dy: number) {
		const active = document.activeElement;
		// Only an armed slider (a press already activated it -- see
		// Slider.svelte) claims the swipe; an unarmed one just sits there while
		// swipes move focus normally, so landing on one and continuing past it
		// doesn't nudge its value.
		if (
			active instanceof HTMLElement &&
			active.hasAttribute('data-pivi-slider') &&
			active.getAttribute('data-pivi-slider-armed') === 'true'
		) {
			if (trySliderAdjust(active, dx, dy)) return;
		}
		moveFocus(dx, dy);
	}

	// Lightweight spatial navigation: from the focused element, pick the
	// nearest other focusable element that lies within a ~60deg cone in the
	// swipe direction, rather than a fixed tab order.
	function moveFocus(dx: number, dy: number) {
		const els = focusableElements();
		if (els.length === 0) return;

		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !els.includes(active)) {
			els[0].focus();
			return;
		}

		const from = active.getBoundingClientRect();
		const fromCenter = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
		const dirLen = Math.hypot(dx, dy) || 1;

		// A mostly-horizontal swipe should stay inside the current shelf: the
		// cone below is wide enough that the next row's cards can otherwise
		// win over "nothing further right in this row", which reads as focus
		// randomly hopping rows instead of stopping at the row's end.
		const shelf = Math.abs(dx) > Math.abs(dy) ? active.closest('[data-pivi-hscroll]') : null;

		let best: HTMLElement | null = null;
		let bestScore = Infinity;

		for (const el of els) {
			if (el === active) continue;
			if (shelf && !shelf.contains(el)) continue;
			const r = el.getBoundingClientRect();
			const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			const vx = center.x - fromCenter.x;
			const vy = center.y - fromCenter.y;
			const dist = Math.hypot(vx, vy);
			if (dist === 0) continue;

			const dot = vx * dx + vy * dy;
			if (dot <= 0) continue;

			const cos = dot / (dist * dirLen);
			if (cos < 0.5) continue;

			const score = dist / cos;
			if (score < bestScore) {
				bestScore = score;
				best = el;
			}
		}

		if (!best) return;
		// Focus alone can jump instantly on some browsers regardless of the
		// container's `scroll-behavior` (Safari in particular), so scroll it
		// into view ourselves first and let focus land without re-scrolling.
		scrollFocusedIntoView(best, els);
		best.focus({ preventScroll: true });
	}

	// `scrollIntoView({block/inline: 'nearest'})` only scrolls as far as
	// making the *focused card* visible, which reads as "stuck" rather than
	// "arrived" in a couple of spots: it's satisfied the instant a shelf's
	// title (now much larger while active) is still scrolled just off the
	// top of the viewport, and it stops short of a shelf's actual scroll
	// limit for its first/last card. So instead: vertically, center whichever
	// row (title included) or the top bar holds focus, and let the browser's
	// own scroll clamping stop that short of the top/bottom of the page —
	// which is exactly "center it, except near an end".
	function scrollFocusedIntoView(el: HTMLElement, focusable: HTMLElement[]) {
		const verticalTarget = el.closest<HTMLElement>('[data-pivi-row], [data-pivi-top-bar]') ?? el;
		const rect = verticalTarget.getBoundingClientRect();
		const elementCenter = rect.top + rect.height / 2;
		const viewportCenter = window.innerHeight / 2;
		window.scrollTo({ top: window.scrollY + elementCenter - viewportCenter, behavior: 'smooth' });

		const shelf = el.closest<HTMLElement>('[data-pivi-hscroll]');
		if (!shelf) return;
		const itemsInShelf = focusable.filter((candidate) => shelf.contains(candidate));
		if (el === itemsInShelf[0]) {
			shelf.scrollTo({ left: 0, behavior: 'smooth' });
		} else if (el === itemsInShelf[itemsInShelf.length - 1]) {
			shelf.scrollTo({ left: shelf.scrollWidth, behavior: 'smooth' });
		} else {
			// Any other card moving out of frame just needs the shelf nudged
			// enough to bring it back in. Done by hand (not
			// `el.scrollIntoView({block: 'nearest', ...})`) because that also
			// re-scrolls the window for the block axis — undoing the vertical
			// centering above, since both target the same window scroll.
			const shelfRect = shelf.getBoundingClientRect();
			const elRect = el.getBoundingClientRect();
			if (elRect.left < shelfRect.left) {
				shelf.scrollBy({ left: elRect.left - shelfRect.left, behavior: 'smooth' });
			} else if (elRect.right > shelfRect.right) {
				shelf.scrollBy({ left: elRect.right - shelfRect.right, behavior: 'smooth' });
			}
		}
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
		target.classList.remove('pivi-press');
		// Force a reflow so re-adding the class restarts the animation even if
		// it's clicked again before the previous run finished.
		void target.offsetWidth;
		target.classList.add('pivi-press');
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

	function setFocusedText(value: string) {
		const el = focusedTextInput();
		if (!el) return;

		const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
		const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
		setter?.call(el, value);
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}

	// A generic "enter" for whatever text field currently has focus: dispatch
	// a real keydown first, so any page-specific handler (e.g. a field that
	// advances a multi-step form on Enter) can claim it via preventDefault;
	// otherwise fall back to submitting the enclosing <form>, if any.
	function submitFocusedText() {
		const el = focusedTextInput();
		if (!el) return;

		const event = new KeyboardEvent('keydown', {
			key: 'Enter',
			code: 'Enter',
			bubbles: true,
			cancelable: true
		});
		el.dispatchEvent(event);
		if (!event.defaultPrevented) el.closest('form')?.requestSubmit();
	}

	onMount(() => {
		document.addEventListener('focusin', onFocusChange);
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
		connection.onNotification(selectNotification, () => {
			if (document.activeElement instanceof HTMLElement) document.activeElement.click();
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
		connection.onNotification(backNotification, () => history.back());
		connection.onNotification(goHomeNotification, () => goto('/home'));
		onNotification(connection, keyNotification, keyParamsSchema, ({ value }) => pressPinKey(value));
		onNotification(connection, textNotification, textParamsSchema, ({ value }) =>
			setFocusedText(value)
		);
		connection.onNotification(enterNotification, () => submitFocusedText());
		connection.onNotification(requestStateNotification, () => sendState());
		onNotification(
			connection,
			remoteConnectedNotification,
			remoteDeviceParamsSchema,
			({ name }) => {
				toast.success(m.remote_connected_toast({ name }), { icon: Smartphone });
			}
		);
		onNotification(
			connection,
			remoteDisconnectedNotification,
			remoteDeviceParamsSchema,
			({ name }) => {
				toast(m.remote_disconnected_toast({ name }), { icon: Unplug });
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
</script>
