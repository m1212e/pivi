<script lang="ts">
	// What the graphics stack looks like from inside the device, for when the TV
	// renders in software and there is no shell to find out why. Opened from
	// the warning in the home screen's top bar.
	import * as m from '#lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { ROUTES } from '#lib/routes';
	import Button from '#lib/components/Button.svelte';
	import { graphics } from '#lib/state/graphics.svelte';

	let report = $state<string>(m.graphics_loading());

	// The Widevine CDM arrives after the first boot online (pivi-widevine in
	// nix/module.nix) and only loads once the kiosk restarts.
	async function widevine(): Promise<string> {
		try {
			const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
				{
					initDataTypes: ['cenc'],
					videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }]
				}
			]);
			await access.createMediaKeys();
			return 'available';
		} catch (err) {
			return `unavailable (${err})`;
		}
	}

	onMount(async () => {
		const browser = [
			'## Browser',
			navigator.userAgent,
			`WebGL: ${graphics.software ?? 'GPU'}`,
			`Widevine: ${await widevine()}`
		].join('\n');
		fetch('/api/system/graphics')
			.then((response) => response.text())
			.then((text) => (report = `${browser}\n\n${text}`))
			.catch((err: unknown) => (report = `${browser}\n\n${err}`));
	});
</script>

<svelte:head><title>{m.graphics_title()}</title></svelte:head>

<div class="flex min-h-screen flex-col gap-6 bg-slate-950 px-8 py-10 text-white sm:px-12">
	<div class="flex items-start justify-between gap-4">
		<h1 class="text-2xl font-semibold">{m.graphics_title()}</h1>
		<Button href={ROUTES.home}>{m.graphics_back()}</Button>
	</div>

	<pre class="text-xs leading-snug whitespace-pre-wrap text-white/80">{report}</pre>
</div>
