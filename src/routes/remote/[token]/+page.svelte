<script lang="ts">
	import { page } from '$app/state';
	import { profileGradient } from '#lib/profileColor';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
	const token = $derived(page.params.token);
</script>

<svelte:head><title>Pivi Remote</title></svelte:head>

<div
	class="flex min-h-screen flex-col items-center gap-10 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-6 py-12 text-white"
>
	<h1 class="text-center text-2xl font-semibold text-white/95">Who's watching?</h1>

	{#if data.expired}
		<p class="max-w-xs text-center text-white/60">
			This QR code has expired. Refresh it on the TV and scan again.
		</p>
	{:else}
		<div class="grid w-full max-w-sm grid-cols-3 gap-6">
			{#each data.profiles as profile (profile.id)}
				{@const label = profile.displayUsername ?? profile.username ?? 'Profile'}
				<a href="/remote/{token}/login/{profile.username}" class="flex flex-col items-center gap-2">
					<span
						class="flex size-20 items-center justify-center overflow-hidden rounded-full"
						style="background: {profileGradient(profile.username ?? profile.id)}"
					>
						{#if profile.image}
							<img src={profile.image} alt="" class="size-full object-cover" />
						{:else}
							<span class="text-2xl font-semibold text-white/90 uppercase">{label.slice(0, 1)}</span
							>
						{/if}
					</span>
					<span class="max-w-full truncate text-sm font-medium text-white/90">{label}</span>
				</a>
			{/each}

			<a href="/remote/{token}/register" class="flex flex-col items-center gap-2">
				<span
					class="flex size-20 items-center justify-center rounded-full border-2 border-dashed border-white/30 bg-white/5 text-white/50"
				>
					<svg viewBox="0 0 24 24" fill="none" class="size-8">
						<path
							d="M12 5v14M5 12h14"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				</span>
				<span class="text-sm font-medium text-white/70">New Profile</span>
			</a>
		</div>
	{/if}
</div>
