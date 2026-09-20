<script lang="ts">
	import { onMount } from 'svelte';
	import type QRCodeStyling from 'qr-code-styling';

	let { url, size = 208 }: { url: string; size?: number } = $props();

	let container: HTMLDivElement;

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
		});

		return () => {
			cancelled = true;
		};
	});
</script>

<div bind:this={container} class="overflow-hidden rounded-2xl leading-none"></div>
