<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { PAIRING_WS_PORT } from '#lib/wsConfig';

	let socket: WebSocket | undefined;
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

	function send(message: Record<string, unknown>) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
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
		send({
			type: 'state',
			hasPinPad: !!document.querySelector('[data-pivi-pinpad]'),
			hasTextInput: !!focusedTextInput(),
			canGoBack: location.pathname !== '/'
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

		let best: HTMLElement | null = null;
		let bestScore = Infinity;

		for (const el of els) {
			if (el === active) continue;
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

		best?.focus();
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

		const observer = new MutationObserver(scheduleFocusRecheck);
		observer.observe(document.body, { childList: true, subtree: true });

		socket = new WebSocket(`ws://${location.hostname}:${PAIRING_WS_PORT}`);
		socket.onopen = () => {
			// Only accepted from the relay's loopback check — this tab and the
			// relay run on the same device. See src/api/ws/relay.ts.
			send({ type: 'tvHello' });
			sendState();
		};

		socket.onmessage = (event) => {
			let message: Record<string, unknown>;
			try {
				message = JSON.parse(event.data);
			} catch {
				return;
			}

			switch (message.type) {
				case 'move':
					moveFocus(Number(message.dx) || 0, Number(message.dy) || 0);
					break;
				case 'select':
					if (document.activeElement instanceof HTMLElement) document.activeElement.click();
					break;
				case 'back':
					history.back();
					break;
				case 'key':
					pressPinKey(String(message.value));
					break;
				case 'text':
					setFocusedText(String(message.value ?? ''));
					break;
				case 'enter':
					submitFocusedText();
					break;
				case 'requestState':
					sendState();
					break;
			}
		};

		return () => {
			document.removeEventListener('focusin', onFocusChange);
			observer.disconnect();
			socket?.close();
		};
	});

	// Re-announce state after every client-side navigation (this component
	// lives in the root layout, so it survives navigation between routes).
	// The previously-focused element is gone either way, so drop the ring
	// eagerly instead of waiting on a stray focusin that may never come.
	afterNavigate(() => {
		currentEl = null;
		queueMicrotask(sendState);
	});
</script>
