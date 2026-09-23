<script lang="ts">
	// A generic slider, horizontal or vertical, that plugs into the same
	// swipe-to-focus remote system every other on-screen control uses instead
	// of needing its own remote-control wiring. While it holds focus, a swipe
	// along its own axis adjusts its value (RemoteBridge.svelte's move
	// handler checks `data-pivi-slider-orientation` on whatever's focused and
	// dispatches a `pivi-slider-adjust` event here instead of moving focus);
	// a swipe across the other axis falls through to the normal spatial-nav
	// move, carrying focus off the slider exactly like leaving any other
	// control. Also directly draggable with a mouse/touchscreen, independent
	// of any of that.
	let {
		value = $bindable(0),
		min = 0,
		max = 1,
		step = 0.01,
		orientation = 'horizontal',
		label,
		// How many pixels of swipe (accumulated across however many move
		// notifications a single gesture produces) cover the full min..max
		// range -- tune per slider for how coarse/fine its range should feel.
		sensitivity = 500,
		// For a value that keeps changing on its own outside of this slider
		// (video playback position, say): while nobody's actively adjusting
		// this slider, `value` tracks `liveValue` instead of standing still.
		// The moment a drag/swipe/keypress starts, that tracking pauses so
		// the live value doesn't fight the interaction, and `onCommit` fires
		// once the interaction settles (debounced, not on every intermediate
		// tick) so a consumer like a seek -- expensive to do continuously --
		// only has to act once, with the final value.
		liveValue,
		onCommit,
		// How long after the last change before it's considered "settled"
		// and onCommit fires / live-tracking resumes.
		settleMs = 300,
		// 'sm' is a thin scrubber track (a video progress bar, say) rather
		// than the thicker default meant to read clearly as its own control.
		size = 'md',
		// Pulled out of the normal a[href]/button/[tabindex] focus candidate
		// set (tabindex="-1") and inert to pointer/keyboard input -- for a
		// screen whose controls should only be reachable while actually
		// shown (see the player page's `locked`), rather than this
		// component's own concept.
		disabled = false
	}: {
		value: number;
		min?: number;
		max?: number;
		step?: number;
		orientation?: 'horizontal' | 'vertical';
		label: string;
		sensitivity?: number;
		liveValue?: number;
		onCommit?: (value: number) => void;
		settleMs?: number;
		size?: 'md' | 'sm';
		disabled?: boolean;
	} = $props();

	let el: HTMLDivElement | undefined = $state();
	let dragging = $state(false);
	let interacting = $state(false);
	let settleTimeout: ReturnType<typeof setTimeout> | undefined;

	function clamp(v: number): number {
		return Math.min(max, Math.max(min, v));
	}

	// Marks an edit in progress and (re)starts the settle countdown -- called
	// from every path that changes `value` in response to user input.
	function markInteracting() {
		interacting = true;
		clearTimeout(settleTimeout);
		settleTimeout = setTimeout(() => {
			interacting = false;
			onCommit?.(value);
		}, settleMs);
	}

	function setFromFraction(fraction: number) {
		const stepped = Math.round((fraction * (max - min)) / step) * step + min;
		value = clamp(stepped);
		markInteracting();
	}

	function adjustBy(delta: number) {
		value = clamp(value + delta);
		markInteracting();
	}

	function updateFromPointer(event: PointerEvent) {
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const fraction =
			orientation === 'horizontal'
				? (event.clientX - rect.left) / rect.width
				: 1 - (event.clientY - rect.top) / rect.height;
		setFromFraction(Math.min(1, Math.max(0, fraction)));
	}

	function onPointerDown(event: PointerEvent) {
		if (disabled) return;
		dragging = true;
		el?.setPointerCapture(event.pointerId);
		updateFromPointer(event);
	}

	function onPointerMove(event: PointerEvent) {
		if (dragging) updateFromPointer(event);
	}

	function onPointerUp() {
		dragging = false;
	}

	// See the file-level comment -- RemoteBridge dispatches this instead of
	// moving focus when a swipe's dominant axis matches `orientation` while
	// this element holds focus.
	function onSwipeAdjust(event: Event) {
		if (disabled) return;
		const { delta } = (event as CustomEvent<{ delta: number }>).detail;
		adjustBy((delta / sensitivity) * (max - min));
	}

	$effect(() => {
		const node = el;
		if (!node) return;
		node.addEventListener('pivi-slider-adjust', onSwipeAdjust);
		return () => node.removeEventListener('pivi-slider-adjust', onSwipeAdjust);
	});

	// Only while idle -- see the props comment on liveValue/onCommit above.
	$effect(() => {
		if (liveValue !== undefined && !interacting) value = liveValue;
	});

	const increaseKeys = { horizontal: 'ArrowRight', vertical: 'ArrowUp' } as const;
	const decreaseKeys = { horizontal: 'ArrowLeft', vertical: 'ArrowDown' } as const;

	function keyDelta(key: string): number {
		if (key === increaseKeys[orientation]) return 1;
		if (key === decreaseKeys[orientation]) return -1;
		return 0;
	}

	function onKeydown(event: KeyboardEvent) {
		if (disabled) return;
		const delta = keyDelta(event.key);
		if (delta === 0) return;
		event.preventDefault();
		adjustBy(delta * step);
	}

	const fraction = $derived((value - min) / (max - min));
	const inset = $derived(size === 'sm' ? 0.125 : 0.375);
</script>

<div
	bind:this={el}
	tabindex={disabled ? -1 : 0}
	role="slider"
	aria-label={label}
	aria-orientation={orientation}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={value}
	aria-disabled={disabled}
	data-pivi-slider
	data-pivi-slider-orientation={orientation}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onkeydown={onKeydown}
	class="relative touch-none rounded-full bg-white/12 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 outline-none {orientation ===
	'horizontal'
		? size === 'sm'
			? 'h-2 w-full min-w-40'
			: 'h-11 w-full min-w-40'
		: size === 'sm'
			? 'h-56 w-2'
			: 'h-56 w-11'}"
>
	<!-- Sized directly (not a transform: scale on a full-size div) so the
	     pill's rounded corners stay circular at any fraction instead of
	     stretching into an ellipse. Only the cross-axis is inset via a
	     shorthand (inset-x/inset-y) -- setting all four sides (inset-1)
	     alongside an explicit bottom+height is over-constrained, and CSS
	     resolves that by dropping `bottom` in favor of `top`, which silently
	     flipped the vertical fill to grow from the top instead of the
	     bottom it was actually meant to anchor to. -->
	<div
		class="absolute rounded-full bg-white {orientation === 'horizontal'
			? 'inset-y-0.5'
			: 'inset-x-0.5'}"
		style={orientation === 'horizontal'
			? `left: ${inset}rem; width: calc(${fraction * 100}% - ${inset * 2}rem)`
			: `bottom: ${inset}rem; height: calc(${fraction * 100}% - ${inset * 2}rem)`}
	></div>
</div>
