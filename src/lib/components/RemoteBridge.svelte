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
		remoteConnectedNotification,
		remoteDisconnectedNotification,
		requestStateNotification,
		selectNotification,
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
		sendNotification(connection, stateNotification, stateParamsSchema, {
			hasPinPad: !!document.querySelector('[data-pivi-pinpad]'),
			hasTextInput: !!focusedTextInput(),
			canGoBack: location.pathname !== '/',
			// Mirrors hooks.server.ts's own definition of "has an active
			// profile" (the routes it guards), rather than adding a separate
			// auth query just for this.
			isLoggedIn: location.pathname === '/home' || location.pathname.startsWith('/apps/')
		});
	}

	function focusableElements() {
		return [
			...document.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		].filter((el) => el.offsetParent !== null);
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
		document.querySelector<HTMLButtonElement>(`[data-pivi-pinpad] [data-key="${key}"]`)?.click();
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

		const observer = new MutationObserver(scheduleFocusRecheck);
		observer.observe(document.body, { childList: true, subtree: true });

		ensureRal();
		socket = new WebSocket(`ws://${location.hostname}:${PAIRING_WS_PORT}`);

		const reader = new PushMessageReader();
		const writer = new SinkMessageWriter((msg) => socket?.send(JSON.stringify(msg)));
		connection = createMessageConnection(reader, writer);

		onNotification(connection, moveNotification, moveParamsSchema, ({ dx, dy }) =>
			moveFocus(dx, dy)
		);
		// These carry no params, so there's nothing for a zod schema to
		// enforce — registered directly on the connection instead of through
		// the onNotification wrapper.
		connection.onNotification(selectNotification, () => {
			if (document.activeElement instanceof HTMLElement) document.activeElement.click();
		});
		connection.onNotification(backNotification, () => history.back());
		connection.onNotification(goHomeNotification, () => goto('/home'));
		onNotification(connection, keyNotification, keyParamsSchema, ({ value }) => pressPinKey(value));
		onNotification(connection, textNotification, textParamsSchema, ({ value }) =>
			setFocusedText(value)
		);
		connection.onNotification(enterNotification, () => submitFocusedText());
		connection.onNotification(requestStateNotification, () => sendState());
		connection.onNotification(remoteConnectedNotification, () => {
			toast.success(m.remote_connected_toast(), { icon: Smartphone });
		});
		connection.onNotification(remoteDisconnectedNotification, () => {
			toast(m.remote_disconnected_toast(), { icon: Unplug });
		});
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
