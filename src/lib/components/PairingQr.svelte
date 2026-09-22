<script lang="ts">
	import { onMount } from 'svelte';
	import type QRCodeStyling from 'qr-code-styling';

	let { url, size = 208 }: { url: string; size?: number } = $props();

	let container: HTMLDivElement;
	// qr-code-styling is dynamically imported and the QR itself is built
	// off-thread, so the container sits empty for a beat after mount —
	// without this the pairing card just shows a blank white square.
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

<div
	class="relative overflow-hidden rounded-2xl leading-none"
	style="width: {size}px; height: {size}px"
>
	{#if !loaded}
		<div class="absolute inset-0 animate-pulse rounded-2xl bg-white/10"></div>
	{/if}
	<div bind:this={container}></div>
</div>
