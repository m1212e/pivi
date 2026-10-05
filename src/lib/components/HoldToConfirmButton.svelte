<script lang="ts">
	// A circular press-and-hold control for a destructive action (uninstall,
	// clear storage) -- replaces the old "tap once to ask, tap again to do
	// it" pattern, which read as two unrelated buttons rather than one
	// deliberate gesture. The circle's own outline is the confirmation: it
	// fills in as the hold continues and only fires once it's complete.
	//
	// A tap too short to move the ring at all would give no feedback that
	// this button even works, so release always floors the ring to a small,
	// visible nudge before easing back to empty -- "you're close, but this
	// needs holding," not "nothing happened."
	//
	// The remote relays its own real press/release as a synthetic
	// pointerdown/pointerup pair (see RemoteBridge.svelte's
	// selectPress/selectReleaseNotification), so a held "select" drives this
	// the same as a held finger on the TV's own screen. A keyboard Enter/Space
	// still only ever produces a plain `click` with nothing around it, so
	// that (and nothing else) is stuck with the short-tap nudge below, never
	// a full confirm.
	import type { Component } from 'svelte';
	import { scale } from 'svelte/transition';
	import { Check } from '@lucide/svelte';

	let {
		label,
		icon: Icon,
		onConfirm,
		holdMs = 900,
		variant = 'danger',
		disabled = false
	}: {
		label: string;
		icon: Component;
		onConfirm: () => void;
		holdMs?: number;
		variant?: 'danger' | 'warning' | 'neutral';
		disabled?: boolean;
	} = $props();

	const SIZE = 48;
	const STROKE = 3;
	const RADIUS = (SIZE - STROKE) / 2;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	const VARIANT_CLASSES = {
		danger: { ring: 'stroke-red-400', badge: 'bg-red-500/15 text-red-200' },
		warning: { ring: 'stroke-amber-300', badge: 'bg-amber-500/15 text-amber-200' },
		neutral: { ring: 'stroke-white/70', badge: 'bg-white/12 text-white/80' }
	} as const;
	// The hint nudge on any tap/release: high enough to read as a deliberate
	// "something happened" rather than a barely-visible flicker, without
	// being mistaken for a near-complete hold.
	const TAP_HINT = 0.3;

	let progress = $state(0);
	let holding = $state(false);
	let rafId: number | null = null;
	let startedAt = 0;
	// A completed hold's pointerup is also a click (pointerdown+pointerup on
	// the same element) -- without this, that synthetic click re-ran onClick's
	// tap-hint handling right behind the real completion, racing the ring
	// back up again instead of letting it hold at full and drop.
	let suppressNextClick = false;
	// Swaps the icon for a checkmark for a beat right after a real confirm.
	let confirmed = $state(false);

	// Three different feels for the one stroke-dashoffset value: instant
	// while an actual hold is filling it in real time (so it tracks the
	// finger/remote exactly), a snap for the tap-hint bump, and a slower
	// spring that overshoots slightly on the way back down to empty --
	// "springs back", rather than draining at a flat linear rate.
	let transitionPhase = $state<'hold' | 'bump' | 'spring'>('hold');
	const BUMP_MS = 160;
	// How long the ring sits at the bumped-up value before springing back --
	// long enough that the bump itself is actually seen, not just a flash
	// that's already reversing before the eye catches it.
	const BUMP_HOLD_MS = 220;
	const SPRING_MS = 650;
	// How long the fully-filled ring and checkmark sit still after a real
	// confirm before both spring back to normal.
	const CONFIRM_HOLD_MS = 650;
	const RING_TRANSITIONS = {
		hold: '0ms linear',
		bump: `${BUMP_MS}ms ease-out`,
		spring: `${SPRING_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`
	} as const;

	function cancelRaf() {
		if (rafId !== null) cancelAnimationFrame(rafId);
		rafId = null;
	}

	// Ease-out cubic: the ring jumps forward right away (clear, immediate
	// feedback that the hold registered) and slows as it nears completion,
	// rather than a flat linear fill that reads as sluggish at the exact
	// moment it most needs to feel responsive.
	function easeOutCubic(t: number) {
		return 1 - (1 - t) ** 3;
	}

	// Bumps the ring to at least TAP_HINT, then springs it back to empty --
	// the shared "something happened, but not enough to confirm" feedback for
	// both a too-short hold and a plain click.
	function tapHint() {
		transitionPhase = 'bump';
		progress = Math.max(progress, TAP_HINT);
		// Wait for the bump's own rise *and* a beat at the peak before
		// switching to the slower spring-back -- flipping back next frame (as
		// this once did) reversed the transition before it had moved
		// anywhere, so the bump was never actually visible. A fresh hold
		// starting in that window (quick tap immediately followed by a press)
		// takes priority -- don't stomp its in-progress fill back down.
		setTimeout(() => {
			if (holding) return;
			transitionPhase = 'spring';
			progress = 0;
		}, BUMP_MS + BUMP_HOLD_MS);
	}

	function grow() {
		const t = Math.min((performance.now() - startedAt) / holdMs, 1);
		transitionPhase = 'hold';
		progress = easeOutCubic(t);
		if (t >= 1) {
			holding = false;
			cancelRaf();
			suppressNextClick = true;
			confirmed = true;
			onConfirm();
			// Let the full ring and the checkmark register for a beat, then
			// spring both back together, rather than snapping straight back
			// to empty/icon the instant the action fires.
			setTimeout(() => {
				transitionPhase = 'spring';
				progress = 0;
				confirmed = false;
			}, CONFIRM_HOLD_MS);
			return;
		}
		rafId = requestAnimationFrame(grow);
	}

	function startHold(event: PointerEvent) {
		if (disabled) return;
		if (event.currentTarget instanceof HTMLElement) {
			// Capture means pointerup/pointercancel still land here even if a
			// finger or cursor drifts off the 48px circle mid-hold -- normal
			// over most of a second. Capture does NOT retarget pointerleave
			// though, so that drift used to fire it and cancel the hold early;
			// there's deliberately no pointerleave handler anymore.
			//
			// The remote relays a hold as a synthetic pointerdown/pointerup
			// pair (see RemoteBridge.svelte) with a pointerId the browser
			// never actually tracked as an active pointer, so capturing it
			// throws -- there's nothing to drift off of in that case anyway.
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				/* synthetic pointer id, not capturable -- nothing to do */
			}
		}
		cancelRaf();
		holding = true;
		startedAt = performance.now();
		grow();
	}

	function endHold() {
		if (!holding) return;
		holding = false;
		cancelRaf();
		// A real pointerdown+pointerup pair (device touch, or now the remote's
		// own press/release) fires a `click` right behind this -- already
		// handled below, so that click shouldn't re-apply the hint a second
		// time on top of it.
		suppressNextClick = true;
		tapHint();
	}

	// See the file-level comment -- a synthetic click (remote/keyboard) never
	// goes through startHold/endHold at all, so it gets the same hint nudge
	// a too-short real tap does.
	function onClick() {
		if (suppressNextClick) {
			suppressNextClick = false;
			return;
		}
		if (holding || disabled) return;
		tapHint();
	}
</script>

<div class="flex items-center gap-2.5">
	<button
		type="button"
		{disabled}
		onpointerdown={startHold}
		onpointerup={endHold}
		onpointercancel={endHold}
		onclick={onClick}
		aria-label={label}
		title={label}
		class="group relative flex shrink-0 touch-none items-center justify-center rounded-full focus:outline-none disabled:opacity-40"
		style="width: {SIZE}px; height: {SIZE}px;"
	>
		<svg
			width={SIZE}
			height={SIZE}
			viewBox="0 0 {SIZE} {SIZE}"
			class="pointer-events-none absolute inset-0 -rotate-90"
		>
			<circle
				cx={SIZE / 2}
				cy={SIZE / 2}
				r={RADIUS}
				fill="none"
				stroke-width={STROKE}
				class="stroke-white/15"
			/>
			<circle
				cx={SIZE / 2}
				cy={SIZE / 2}
				r={RADIUS}
				fill="none"
				stroke-width={STROKE}
				stroke-linecap="round"
				stroke-dasharray={CIRCUMFERENCE}
				stroke-dashoffset={CIRCUMFERENCE * (1 - progress)}
				class={VARIANT_CLASSES[variant].ring}
				style="transition: stroke-dashoffset {RING_TRANSITIONS[transitionPhase]}"
			/>
		</svg>
		<span
			class="flex size-9 items-center justify-center rounded-full transition group-active:scale-95 {VARIANT_CLASSES[
				variant
			].badge}"
		>
			{#if confirmed}
				<span in:scale={{ duration: 220, start: 0.4 }}>
					<Check class="size-4.5" />
				</span>
			{:else}
				<span in:scale={{ duration: 150, start: 0.4 }}>
					<Icon class="size-4.5" />
				</span>
			{/if}
		</span>
	</button>
	<span class="text-sm text-white/70">{label}</span>
</div>
