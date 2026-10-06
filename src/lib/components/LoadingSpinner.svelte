<script lang="ts">
	import * as m from '#lib/paraglide/messages';

	// Ring spinner with a soft pulsing halo, for content that has no known
	// shape yet (a skeleton needs one). The label is only for screen readers.
	let { label = m.loading() }: { label?: string } = $props();
</script>

<div class="flex flex-1 items-center justify-center py-24" role="status">
	<div class="relative size-16">
		<span class="pivi-spinner-halo absolute inset-0 rounded-full bg-white/20"></span>
		<svg viewBox="0 0 50 50" class="pivi-spinner-ring relative size-full" aria-hidden="true">
			<circle
				cx="25"
				cy="25"
				r="20"
				fill="none"
				stroke="white"
				stroke-opacity="0.12"
				stroke-width="4"
			/>
			<circle
				class="pivi-spinner-arc"
				cx="25"
				cy="25"
				r="20"
				fill="none"
				stroke="white"
				stroke-width="4"
				stroke-linecap="round"
			/>
		</svg>
	</div>
	<span class="sr-only">{label}</span>
</div>

<style>
	.pivi-spinner-ring {
		animation: pivi-spinner-rotate 1.6s linear infinite;
	}
	/* The arc grows and shrinks while the ring turns, so it never looks stalled. */
	.pivi-spinner-arc {
		stroke-dasharray: 1 126;
		animation: pivi-spinner-dash 1.4s ease-in-out infinite;
	}
	.pivi-spinner-halo {
		animation: pivi-spinner-halo 2s ease-in-out infinite;
	}
	@keyframes pivi-spinner-rotate {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes pivi-spinner-dash {
		0% {
			stroke-dasharray: 1 126;
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dasharray: 90 126;
			stroke-dashoffset: -35;
		}
		100% {
			stroke-dasharray: 90 126;
			stroke-dashoffset: -124;
		}
	}
	@keyframes pivi-spinner-halo {
		0%,
		100% {
			opacity: 0;
			transform: scale(0.6);
		}
		50% {
			opacity: 0.5;
			transform: scale(1.15);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pivi-spinner-ring,
		.pivi-spinner-arc,
		.pivi-spinner-halo {
			animation-duration: 6s;
		}
	}
</style>
