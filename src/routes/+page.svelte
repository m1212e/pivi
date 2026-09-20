<script lang="ts">
	import { onMount } from 'svelte';
	import { profileGradient } from '#lib/profileColor';
	import PairingQr from '#lib/components/PairingQr.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	onMount(() => {
		const interval = setInterval(async () => {
			const res = await fetch(`/pair/${data.pairingToken}/status`);
			const { resolved } = await res.json();
			if (resolved) {
				clearInterval(interval);
				location.href = '/home';
			}
		}, 1500);

		return () => clearInterval(interval);
	});
</script>

<svelte:head><title>Pivi</title></svelte:head>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-16 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-8 py-16 text-white"
>
	<h1 class="text-4xl font-semibold tracking-tight text-white/95 sm:text-5xl">Who's watching?</h1>

	<div class="flex flex-wrap items-start justify-center gap-x-12 gap-y-10">
		{#each data.profiles as profile (profile.id)}
			{@const label = profile.displayUsername ?? profile.username ?? 'Profile'}
			<a
				href="/login/{profile.username}"
				class="group flex w-32 flex-col items-center gap-3 focus:outline-none sm:w-36"
			>
				<span
					class="flex size-28 items-center justify-center overflow-hidden rounded-full ring-4 ring-transparent transition group-hover:scale-105 group-hover:ring-white/80 group-focus-visible:scale-105 group-focus-visible:ring-white sm:size-32"
					style="background: {profileGradient(profile.username ?? profile.id)}"
				>
					{#if profile.image}
						<img src={profile.image} alt="" class="size-full object-cover" />
					{:else}
						<span class="text-4xl font-semibold text-white/90 uppercase sm:text-5xl">
							{label.slice(0, 1)}
						</span>
					{/if}
				</span>
				<span class="max-w-full truncate text-lg font-medium text-white/90">{label}</span>
			</a>
		{/each}

		<a
			href="/register"
			class="group flex w-32 flex-col items-center gap-3 focus:outline-none sm:w-36"
		>
			<span
				class="flex size-28 items-center justify-center rounded-full border-2 border-dashed border-white/30 bg-white/5 text-white/50 ring-4 ring-transparent transition group-hover:scale-105 group-hover:border-white/70 group-hover:text-white/80 group-hover:ring-white/40 group-focus-visible:scale-105 group-focus-visible:border-white group-focus-visible:text-white group-focus-visible:ring-white sm:size-32"
			>
				<svg viewBox="0 0 24 24" fill="none" class="size-12 sm:size-14">
					<path
						d="M12 5v14M5 12h14"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			</span>
			<span class="text-lg font-medium text-white/70">New Profile</span>
		</a>
	</div>

	{#if data.remoteUrl}
		<div class="flex items-center gap-5 rounded-3xl bg-white/5 px-6 py-5 ring-1 ring-white/10">
			<PairingQr url={data.remoteUrl} size={104} />
			<div class="max-w-56 text-sm text-white/60">
				<p class="font-medium text-white/90">Scan with your phone</p>
				<p>Use the Pivi remote to sign in, create a profile, and control playback.</p>
			</div>
		</div>
	{/if}
</div>
