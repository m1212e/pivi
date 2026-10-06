<script lang="ts">
	import { onMount } from 'svelte';
	import type QRCodeStyling from 'qr-code-styling';

	// The one QR renderer for both the pairing code and the wifi join code, so
	// they share the styling. The library is imported lazily to keep it out of
	// the initial bundle.
	let { url, size = 208 }: { url: string; size?: number } = $props();

	let container: HTMLDivElement;
	// The lazy import leaves the container empty for a beat, which would show
	// as a blank white square without a placeholder.
	let loaded = $state(false);

	onMount(() => {
		let cancelled = false;
		let qr: QRCodeStyling | undefined;

		import('qr-code-styling').then(({ default: QRCodeStyling }) => {
			if (cancelled) return;
			qr = new QRCodeStyling({
				width: size,
				height: size,
				type: 'svg',
				data: url,
				margin: 8,
				qrOptions: { errorCorrectionLevel: 'M' },
				dotsOptions: {
					type: 'extra-rounded',
					gradient: {
						type: 'linear',
						rotation: Math.PI / 4,
						colorStops: [
							{ offset: 0, color: '#818cf8' },
							{ offset: 1, color: '#c084fc' }
						]
					}
				},
				cornersSquareOptions: { type: 'extra-rounded', color: '#4f46e5' },
				cornersDotOptions: { type: 'dot', color: '#a855f7' },
				backgroundOptions: { color: '#ffffff' }
			});
			qr.append(container);
			loaded = true;
		});

		return () => {
			cancelled = true;
		};
	});
</script>

<!--
	`size` renders as rem (size / 16), not raw px, so this container scales
	with the rest of the TV UI on a bigger screen (see #lib/tvScale) instead
	of staying a fixed physical size while everything around it grows. The
	library still builds the QR itself as an SVG at the literal `size` px
	given below -- `[&>svg]:size-full` is what makes that vector output
	stretch to fill however big the rem-sized container actually renders,
	rather than clipping/floating at its own native pixel dimensions.
-->
<div
	class="relative overflow-hidden rounded-2xl leading-none"
	style="width: {size / 16}rem; height: {size / 16}rem"
>
	{#if !loaded}
		<div class="absolute inset-0 animate-pulse rounded-2xl bg-white/10"></div>
	{/if}
	<div bind:this={container} class="[&>svg]:size-full"></div>
</div>
