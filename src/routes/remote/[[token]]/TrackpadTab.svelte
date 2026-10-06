<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import { createTrackpadGestures, type TrackpadActions } from '#lib/pairing/trackpadGestures';

	let { actions }: { actions: TrackpadActions } = $props();

	// Wrapped so a changed `actions` prop is picked up instead of the first one captured.
	const gestures = createTrackpadGestures({
		press: () => actions.press(),
		release: () => actions.release(),
		cancel: () => actions.cancel(),
		move: (dx, dy) => actions.move(dx, dy)
	});

	const pointOf = (event: TouchEvent) => ({
		x: event.touches[0].clientX,
		y: event.touches[0].clientY
	});
</script>

<div
	role="application"
	aria-label={m.trackpad_label()}
	ontouchstart={(event) => gestures.start(pointOf(event))}
	ontouchmove={(event) => gestures.move(pointOf(event))}
	ontouchend={() => gestures.end()}
	ontouchcancel={() => gestures.interrupt()}
	style:view-transition-name="phone-trackpad"
	class="flex size-full max-h-96 w-full max-w-sm touch-none items-center justify-center rounded-3xl bg-white/12 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 select-none"
>
	<p class="px-8 text-center text-sm text-white/40">{m.swipe_hint()}</p>
</div>
