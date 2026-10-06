<script lang="ts">
	// Press and hold for AppManagerPanel's destructive actions, so one deliberate
	// gesture confirms instead of a tap-twice pattern. The remote relays a held
	// select as pointerdown/pointerup, so it can hold too. A bare click never confirms.
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
	// High enough to be seen, low enough not to look like a near-complete hold.
	const TAP_HINT = 0.3;

	let progress = $state(0);
	let holding = $state(false);
	let rafId: number | null = null;
	let startedAt = 0;
	// The click that follows pointerup must not replay the tap hint on top of
	// a finished hold or release.
	let suppressNextClick = false;
	// Swaps the icon for a checkmark for a beat right after a real confirm.
	let confirmed = $state(false);

	// Instant while holding so the ring tracks the press, a quick bump for the
	// tap hint, and an overshooting spring on the way back to empty.
	let transitionPhase = $state<'hold' | 'bump' | 'spring'>('hold');
	const BUMP_MS = 160;
	// Pause at the bump's peak so it's seen before it springs back.
	const BUMP_HOLD_MS = 220;
	const SPRING_MS = 650;
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

	// Fast start so the hold visibly registers at once, a linear fill feels sluggish.
	function easeOutCubic(t: number) {
		return 1 - (1 - t) ** 3;
	}

	// Without this a short tap shows nothing and the button seems broken.
	// Signals that it needs holding, for short holds and plain clicks alike.
	function tapHint() {
		transitionPhase = 'bump';
		progress = Math.max(progress, TAP_HINT);
		// Flipping back sooner reverses the bump before it's visible. A new hold
		// started in the meantime wins.
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
			// Capture keeps pointerup here when a finger drifts off the small
			// circle. No pointerleave handler on purpose, drift would cancel it.
			// The remote's synthetic pointer id can't be captured and throws.
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				/* remote press, nothing can drift */
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
		suppressNextClick = true;
		tapHint();
	}

	// Keyboard Enter or Space only clicks, so it gets the hint instead of a confirm.
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
