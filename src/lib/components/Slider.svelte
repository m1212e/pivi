<script lang="ts">
	import { DOM_EVENTS } from '#lib/domEvents';
	// The player's progress and volume bars and the remote's player tab. A press
	// arms it so a swipe passing over it never moves the value. While armed,
	// RemoteBridge turns swipes along its axis into `pivi-slider-adjust`.
	let {
		value = $bindable(0),
		min = 0,
		max = 1,
		step = 0.01,
		orientation = 'horizontal',
		label,
		// Pixels of swipe for the full range, to tune how fine it feels.
		sensitivity = 500,
		// For values that move on their own, like playback position. Followed
		// while idle, paused during an interaction, and `onCommit` fires once
		// it settles, so an expensive seek only runs for the final value.
		liveValue,
		onCommit,
		// Every intermediate value, for cheap consumers like volume.
		onChange,
		settleMs = 300,
		// A seek takes a while to show up in `liveValue`, so the bar holds the
		// committed value until live gets this close, instead of snapping back
		// and jumping forward. Widen it for imprecise commits like keyframe seeks.
		commitTolerance,
		// Gives up on convergence after this, so a failed seek can't freeze the bar.
		commitHoldMs = 5000,
		// 'sm' is the thin scrubber track of the progress bar.
		size = 'md',
		// For the player's locked state, where hidden controls must not be
		// focusable or react to input.
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
	// Landing on or swiping past the slider must not move it, so every way of
	// changing the value waits for a press first. Mirrored to
	// `data-pivi-slider-armed` so RemoteBridge knows whether to hand it swipes.
	let armed = $state(false);
	let settleTimeout: ReturnType<typeof setTimeout> | undefined;
	// The last committed value while `liveValue` hasn't caught up to it yet.
	let pendingCommit = $state<number | undefined>(undefined);
	let pendingTimeout: ReturnType<typeof setTimeout> | undefined;
	const tolerance = $derived(commitTolerance ?? step * 2);

	function clamp(v: number): number {
		return Math.min(max, Math.max(min, v));
	}

	// Every input path calls this so the settle countdown and live pausing
	// behave the same for drag, swipe and keys.
	function markInteracting() {
		interacting = true;
		// Scrubbing again before the last seek landed moves the target.
		clearPendingCommit();
		onChange?.(value);
		clearTimeout(settleTimeout);
		settleTimeout = setTimeout(settle, settleMs);
	}

	function clearPendingCommit() {
		pendingCommit = undefined;
		clearTimeout(pendingTimeout);
	}

	// Commits and starts waiting for `liveValue` to catch up. Pointer release
	// calls it directly, as it's a clear end and shortens the time they disagree.
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
		// RemoteBridge's select press is a synthetic pointer at 0,0, which would
		// drag the value to an edge. onClick handles arming for it instead.
		if (disabled || !event.isTrusted) return;
		// A first press only arms, so a misaimed click costs nothing.
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

	// The remote's select arrives as a programmatic `.click()` with detail 0.
	// Real clicks already armed through onPointerDown, so they're ignored.
	function onClick(event: MouseEvent) {
		if (disabled || event.detail !== 0) return;
		armed = !armed;
	}

	function onBlur() {
		armed = false;
		// Focus leaving mid-gesture, like the player hiding its controls, must
		// still commit before the component may go away.
		dragging = false;
		settle();
	}

	function onSwipeAdjust(event: Event) {
		if (disabled || !armed) return;
		const { delta } = (event as CustomEvent<{ delta: number }>).detail;
		adjustBy((delta / sensitivity) * (max - min));
	}

	$effect(() => {
		const node = el;
		if (!node) return;
		node.addEventListener(DOM_EVENTS.sliderAdjust, onSwipeAdjust);
		return () => node.removeEventListener(DOM_EVENTS.sliderAdjust, onSwipeAdjust);
	});

	// Holds the committed value until live reaches it, so the bar doesn't
	// rubber-band back to the old position while a seek is in flight.
	function trackedValue(live: number): number {
		if (pendingCommit === undefined) return live;
		if (Math.abs(live - pendingCommit) > tolerance) return pendingCommit;
		clearPendingCommit();
		return live;
	}

	// Only while idle, an interaction in progress owns `value`.
	$effect(() => {
		if (liveValue === undefined || interacting) return;
		value = trackedValue(liveValue);
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

	// Not a native button, so Enter and Space need their own arm toggle.
	function isActivationKey(key: string): boolean {
		return key === 'Enter' || key === ' ';
	}

	// Reports whether the key was handled, so only those get swallowed.
	function adjustFromKey(key: string): boolean {
		const delta = keyDelta(key);
		if (delta === 0 || !armed) return false;
		adjustBy(delta * step);
		return true;
	}

	function onKeydown(event: KeyboardEvent) {
		if (disabled) return;
		if (isActivationKey(event.key)) armed = !armed;
		else if (!adjustFromKey(event.key)) return;
		event.preventDefault();
	}

	// `max` is 0 while a video's duration is unknown, which would give NaN
	// and drop the fill style entirely.
	const fraction = $derived(max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0);

	// While armed, the fill's edge is an animated wave so it's clear from across
	// the room which slider a swipe will move. Tiled as a background so the
	// wavelength stays fixed at any track length and scrolling it is cheap.
	const WAVE_TILE_X =
		"url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2016'%20preserveAspectRatio='none'%3E%3Cpath%20d='M0,8%20q6,-8%2012,0%20q6,8%2012,0%20L24,16%20L0,16%20Z'%20fill='%23fff'/%3E%3C/svg%3E\")";
	const WAVE_TILE_Y =
		"url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2024'%20preserveAspectRatio='none'%3E%3Cpath%20d='M8,0%20q-8,6%200,12%20q8,6%200,12%20L0,24%20L0,0%20Z'%20fill='%23fff'/%3E%3C/svg%3E\")";
	// `len` is one wavelength, `band` the strip the wave is drawn in, in rem so
	// tvScale carries them. The band straddles the edge so troughs cut into the
	// fill. `back` is a bit less than `half` because butting them up exactly
	// left a hairline seam on some pixel boundaries.
	const wave = $derived.by(() => {
		const { len, band } = size === 'sm' ? { len: 0.5, band: 0.3 } : { len: 1, band: 0.6 };
		return {
			len: `${len}rem`,
			band: `${band}rem`,
			half: `${band / 2}rem`,
			back: `${(band * 3) / 8}rem`
		};
	});

	// A horizontal slider's leading edge is vertical, so it takes the `-y` tile.
	const AXIS = {
		horizontal: {
			fillEdge: 'inset-y-0 left-0',
			solidSide: 'right',
			waveEdge: 'pivi-slider-wave-y inset-y-0',
			waveTile: WAVE_TILE_Y
		},
		vertical: {
			fillEdge: 'inset-x-0 bottom-0',
			solidSide: 'top',
			waveEdge: 'pivi-slider-wave-x inset-x-0',
			waveTile: WAVE_TILE_X
		}
	} as const;
	const TRACK_SIZE = {
		horizontal: { sm: 'h-2 w-full min-w-40', md: 'h-11 w-full min-w-40' },
		vertical: { sm: 'h-56 w-2', md: 'h-56 w-11' }
	} as const;

	const axis = $derived(AXIS[orientation]);
	const trackSizeClass = $derived(TRACK_SIZE[orientation][size]);
	const fillStyle = $derived(
		orientation === 'horizontal' ? `width: ${fraction * 100}%` : `height: ${fraction * 100}%`
	);
	// Makes room for the wave band, which straddles the fill's edge.
	const solidStyle = $derived(`${axis.solidSide}: ${armed ? wave.back : '0px'}`);
	const waveStyle = $derived.by(() => {
		const horizontal = orientation === 'horizontal';
		const tileSize = horizontal ? `${wave.band} ${wave.len}` : `${wave.len} ${wave.band}`;
		const place = horizontal
			? `width: ${wave.band}; right: calc(-1 * ${wave.half})`
			: `height: ${wave.band}; top: calc(-1 * ${wave.half})`;
		// Frozen rather than hidden while unarmed, so the fade-out drifts to a
		// stop instead of snapping back to the start of the loop.
		const play = armed ? 'running' : 'paused';
		return `--pivi-wave-len: ${wave.len}; background-image: ${axis.waveTile}; background-size: ${tileSize}; animation-play-state: ${play}; ${place}`;
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
	class="relative touch-none overflow-hidden rounded-full bg-white/12 shadow-lg ring-1 shadow-black/20 ring-white/20 outline-none {trackSizeClass}"
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
		class="absolute {axis.fillEdge} {dragging
			? ''
			: 'transition-[width,height] duration-200 ease-out'}"
		style={fillStyle}
	>
		<!-- Everything but the leading edge. -->
		<div
			class="absolute bg-white transition-all duration-200 {axis.fillEdge}"
			style={solidStyle}
		></div>
		<!-- The leading edge itself. Always rendered (so arming/unarming can
		     cross-fade it rather than popping) -- see waveStyle for why it's
		     frozen rather than removed while unarmed. -->
		<div
			class="absolute transition-opacity duration-200 {axis.waveEdge} {armed
				? 'opacity-100'
				: 'opacity-0'}"
			style={waveStyle}
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
