<script lang="ts">
	// A generic slider, horizontal or vertical, that plugs into the same
	// swipe-to-focus remote system every other on-screen control uses instead
	// of needing its own remote-control wiring. While it holds focus AND is
	// armed, a swipe along its own axis adjusts its value (RemoteBridge.svelte's
	// move handler checks `data-pivi-slider-orientation`/`-armed` on whatever's
	// focused and dispatches a `pivi-slider-adjust` event here instead of
	// moving focus); a swipe across the other axis, or any swipe while unarmed,
	// falls through to the normal spatial-nav move, carrying focus off the
	// slider exactly like leaving any other control. Arming itself takes a
	// press (click, tap, remote select, or Enter/Space) -- see `armed` below --
	// so simply landing on or swiping past a slider never moves it. Also
	// directly draggable with a mouse/touchscreen, independent of any of that.
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
		// Fires on every intermediate value, not just the settled one -- for a
		// consumer cheap enough to drive continuously (a volume level, unlike a
		// seek's expensive stream reopen).
		onChange,
		// How long after the last change before it's considered "settled"
		// and onCommit fires / live-tracking resumes.
		settleMs = 300,
		// How close `liveValue` has to get to a just-committed value before
		// this goes back to following it. Whatever `onCommit` kicks off
		// (a seek, and on the phone a seek relayed over the network first)
		// takes a while to actually show up in `liveValue`, so resuming the
		// moment it settles would snap the bar back to the pre-seek value for
		// a beat and then jump forward again once the seek lands -- exactly
		// the "jumping around" a scrub looks like without this. Defaults to
		// two steps, which is the right order of magnitude for a value whose
		// step is already its meaningful resolution; a consumer whose commit
		// lands less precisely than that (a stream reopened at a keyframe,
		// say) should widen it.
		commitTolerance,
		// How long to hold that committed value before giving up on the live
		// value ever converging and following it again regardless -- a seek
		// that fails outright (or one the TV clamps somewhere else entirely)
		// must not leave the bar frozen on a position nothing is playing.
		commitHoldMs = 5000,
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
		onChange?: (value: number) => void;
		settleMs?: number;
		commitTolerance?: number;
		commitHoldMs?: number;
		size?: 'md' | 'sm';
		disabled?: boolean;
	} = $props();

	let el: HTMLDivElement | undefined = $state();
	let dragging = $state(false);
	let interacting = $state(false);
	// Gates every way of changing `value` (drag, swipe, arrow keys) behind an
	// explicit press first, so landing focus on the slider or swiping/dragging
	// across it while aiming for something else doesn't move it. A press
	// toggles this on, a second press toggles it back off, and losing focus
	// always drops it -- see onPointerDown/onKeydown/onClick and the blur
	// handler below. Mirrored to `data-pivi-slider-armed` so RemoteBridge
	// knows whether to hand a swipe to this slider or let it move focus.
	let armed = $state(false);
	let settleTimeout: ReturnType<typeof setTimeout> | undefined;
	// The value the last commit asked for, while it's still being waited on
	// (see `commitTolerance`). `undefined` means "nothing outstanding, follow
	// `liveValue` normally".
	let pendingCommit = $state<number | undefined>(undefined);
	let pendingTimeout: ReturnType<typeof setTimeout> | undefined;
	const tolerance = $derived(commitTolerance ?? step * 2);

	function clamp(v: number): number {
		return Math.min(max, Math.max(min, v));
	}

	// Marks an edit in progress and (re)starts the settle countdown -- called
	// from every path that changes `value` in response to user input.
	function markInteracting() {
		interacting = true;
		// A fresh edit supersedes whatever the previous one committed --
		// otherwise scrubbing again before the last seek landed would keep
		// waiting on a target the viewer has already moved off.
		clearPendingCommit();
		onChange?.(value);
		clearTimeout(settleTimeout);
		settleTimeout = setTimeout(settle, settleMs);
	}

	function clearPendingCommit() {
		pendingCommit = undefined;
		clearTimeout(pendingTimeout);
	}

	// Ends the current interaction: fires `onCommit` and starts waiting for
	// `liveValue` to catch up to what was committed. Called on the settle
	// timer, and directly on pointer release -- letting go of a drag is an
	// unambiguous end of the gesture, so there's nothing to wait out there,
	// and committing right away shortens the window in which the displayed
	// value and whatever `onCommit` drives can disagree.
	function settle() {
		clearTimeout(settleTimeout);
		if (!interacting) return;
		interacting = false;
		const committed = value;
		if (liveValue !== undefined) {
			pendingCommit = committed;
			clearTimeout(pendingTimeout);
			pendingTimeout = setTimeout(clearPendingCommit, commitHoldMs);
		}
		onCommit?.(committed);
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
		// First press just arms the slider -- doesn't move the thumb or start a
		// drag, so a click made while aiming for this control instead of past
		// it costs nothing. Only once armed does a press start adjusting.
		if (!armed) {
			armed = true;
			return;
		}
		dragging = true;
		el?.setPointerCapture(event.pointerId);
		updateFromPointer(event);
	}

	function onPointerMove(event: PointerEvent) {
		if (dragging) updateFromPointer(event);
	}

	function onPointerUp() {
		if (!dragging) return;
		dragging = false;
		settle();
	}

	// Toggles arming for presses that don't go through onPointerDown above --
	// namely RemoteBridge's `.click()` on the focused element for the remote's
	// select button. A real mouse/touch press already armed (or dragged) via
	// onPointerDown, and the `click` that follows it as a matter of course
	// fires with `detail` >= 1, so that path is ignored here; a programmatic
	// `.click()` fires with `detail` 0, which is what this reacts to.
	function onClick(event: MouseEvent) {
		if (disabled || event.detail !== 0) return;
		armed = !armed;
	}

	function onBlur() {
		armed = false;
		// Focus leaving mid-gesture (a remote swiping away, the player hiding
		// its controls) would otherwise leave the interaction open until the
		// settle timer fires, with the edit never committed if the component
		// goes away first.
		dragging = false;
		settle();
	}

	// See the file-level comment -- RemoteBridge dispatches this instead of
	// moving focus when a swipe's dominant axis matches `orientation` while
	// this element holds focus and it's armed (see `data-pivi-slider-armed`).
	function onSwipeAdjust(event: Event) {
		if (disabled || !armed) return;
		const { delta } = (event as CustomEvent<{ delta: number }>).detail;
		adjustBy((delta / sensitivity) * (max - min));
	}

	$effect(() => {
		const node = el;
		if (!node) return;
		node.addEventListener('pivi-slider-adjust', onSwipeAdjust);
		return () => node.removeEventListener('pivi-slider-adjust', onSwipeAdjust);
	});

	// Only while idle, and only once a just-committed value has actually been
	// reached -- see the props comments on liveValue/onCommit/commitTolerance
	// above. Until then the committed value is what stays on screen, so the
	// bar holds where the viewer put it rather than rubber-banding back to
	// where playback still is while the seek is in flight.
	$effect(() => {
		if (liveValue === undefined || interacting) return;
		if (pendingCommit !== undefined) {
			if (Math.abs(liveValue - pendingCommit) > tolerance) {
				value = pendingCommit;
				return;
			}
			clearPendingCommit();
		}
		value = liveValue;
	});

	$effect(() => () => {
		clearTimeout(settleTimeout);
		clearTimeout(pendingTimeout);
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
		// Not a native button, so Enter/Space need their own arm toggle here --
		// same press-to-activate gesture as onClick above.
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			armed = !armed;
			return;
		}
		const delta = keyDelta(event.key);
		if (delta === 0 || !armed) return;
		event.preventDefault();
		adjustBy(delta * step);
	}

	// Clamped, and zero for a degenerate range -- `max` can legitimately be 0
	// before the thing being measured is known (a video whose duration hasn't
	// come back yet), which would otherwise make this NaN and drop the fill's
	// width/height style entirely, leaving the bar stuck at whatever it last
	// rendered.
	const fraction = $derived(max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0);

	// While armed, the fill's leading edge (the top of a vertical slider, the
	// right of a horizontal one -- the line that reads as "the current value")
	// is drawn as a travelling sine wave instead of a flat cut, so it's obvious
	// at a glance from across the room which slider a swipe is about to move.
	// The wave is one period of SVG tiled along the edge as a background image
	// (rather than a single stretched SVG) so its wavelength stays constant
	// whatever the track's length is, and animated by scrolling the background
	// by exactly one tile -- seamless, and composited by the browser rather
	// than re-rendered per frame here. Two tiles: `-x` runs the crest along the
	// width for a horizontal band, `-y` down the height for a vertical one,
	// each filled on the side the fill sits on so the curve *is* the boundary.
	const WAVE_TILE_X =
		"url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2016'%20preserveAspectRatio='none'%3E%3Cpath%20d='M0,8%20q6,-8%2012,0%20q6,8%2012,0%20L24,16%20L0,16%20Z'%20fill='%23fff'/%3E%3C/svg%3E\")";
	const WAVE_TILE_Y =
		"url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2024'%20preserveAspectRatio='none'%3E%3Cpath%20d='M8,0%20q-8,6%200,12%20q8,6%200,12%20L0,24%20L0,0%20Z'%20fill='%23fff'/%3E%3C/svg%3E\")";
	// `len` is one wavelength, `band` the thickness of the strip the wave is
	// drawn in; both are stretched to from the tile viewBoxes above, so they're
	// free to be tuned independently of each other. Crest-to-trough is a
	// quarter of `band` (the tile's own proportion), and the band straddles the
	// edge, reaching `half` past it -- so the troughs cut into the fill rather
	// than the crests sitting on top of an already-flat edge. In rem, like
	// everything else here, so tvScale's root font size carries them.
	//
	// `back` is how far the solid part of the fill is then pulled back to make
	// room for the band. Deliberately *less* than `half`: butting the two up
	// exactly left a hairline of track showing through the seam wherever the
	// two edges landed either side of a device pixel. The troughs bottom out a
	// quarter of the band above its far edge, so that last quarter is always
	// solid fill colour -- overlapping into half of it hides the seam without
	// the overlap ever showing above a trough.
	const wave = $derived.by(() => {
		const { len, band } = size === 'sm' ? { len: 0.5, band: 0.3 } : { len: 1, band: 0.6 };
		return {
			len: `${len}rem`,
			band: `${band}rem`,
			half: `${band / 2}rem`,
			back: `${(band * 3) / 8}rem`
		};
	});
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
	data-pivi-slider-armed={armed}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onclick={onClick}
	onblur={onBlur}
	onkeydown={onKeydown}
	class="relative touch-none overflow-hidden rounded-full bg-white/12 shadow-lg ring-1 shadow-black/20 ring-white/20 outline-none {orientation ===
	'horizontal'
		? size === 'sm'
			? 'h-2 w-full min-w-40'
			: 'h-11 w-full min-w-40'
		: size === 'sm'
			? 'h-56 w-2'
			: 'h-56 w-11'}"
>
	<!-- No rounding, inset, or gap of its own -- the track above clips it
	     (`overflow-hidden` + the same `rounded-full`) into the track's own
	     rounded shape at both ends, so this just reads as the pill itself
	     filling up rather than a separate, smaller pill floating inside it.
	     Transparent itself: it only sizes/positions the fill, which its two
	     children draw between them (solid part + wavy leading edge).

	     Its length eases into place so a step/swipe/remote adjustment slides
	     the bar to the new value rather than jumping. Dropped while dragging:
	     there the fill has to sit exactly under the finger/cursor, and easing
	     towards it would just read as lag. -->
	<div
		class="absolute {orientation === 'horizontal'
			? 'inset-y-0 left-0'
			: 'inset-x-0 bottom-0'} {dragging ? '' : 'transition-[width,height] duration-200 ease-out'}"
		style={orientation === 'horizontal'
			? `width: ${fraction * 100}%`
			: `height: ${fraction * 100}%`}
	>
		<!-- Everything but the leading edge. Pulled back by half a wave band
		     while armed so the wave below straddles the edge rather than
		     stacking on top of a flat one. -->
		<div
			class="absolute bg-white transition-all duration-200 {orientation === 'horizontal'
				? 'inset-y-0 left-0'
				: 'inset-x-0 bottom-0'}"
			style="{orientation === 'horizontal' ? 'right' : 'top'}: {armed ? wave.back : '0px'}"
		></div>
		<!-- The leading edge itself. Always rendered (so arming/unarming can
		     cross-fade it rather than popping), but frozen while unarmed --
		     the fade-out then drifts to a stop instead of snapping back to
		     the start of the loop. -->
		<div
			class="absolute transition-opacity duration-200 {orientation === 'horizontal'
				? 'pivi-slider-wave-y inset-y-0'
				: 'pivi-slider-wave-x inset-x-0'} {armed ? 'opacity-100' : 'opacity-0'}"
			style="--pivi-wave-len: {wave.len}; background-image: {orientation === 'horizontal'
				? WAVE_TILE_Y
				: WAVE_TILE_X}; background-size: {orientation === 'horizontal'
				? `${wave.band} ${wave.len}`
				: `${wave.len} ${wave.band}`}; animation-play-state: {armed
				? 'running'
				: 'paused'}; {orientation === 'horizontal'
				? `width: ${wave.band}; right: calc(-1 * ${wave.half})`
				: `height: ${wave.band}; top: calc(-1 * ${wave.half})`}"
		></div>
	</div>
</div>

<style>
	/* Scrolling the background by exactly one tile loops seamlessly -- see the
	   WAVE_TILE_* comment in the script above. */
	@keyframes pivi-slider-wave-x {
		to {
			background-position-x: var(--pivi-wave-len);
		}
	}
	@keyframes pivi-slider-wave-y {
		to {
			background-position-y: var(--pivi-wave-len);
		}
	}
	.pivi-slider-wave-x {
		background-repeat: repeat-x;
		animation: pivi-slider-wave-x 1.2s linear infinite;
	}
	.pivi-slider-wave-y {
		background-repeat: repeat-y;
		animation: pivi-slider-wave-y 1.2s linear infinite;
	}
</style>
