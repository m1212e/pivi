<script lang="ts">
	import { fly } from 'svelte/transition';
	import type { TvState } from '#lib/remote/remoteController.svelte';
	import { profileGradient } from '#lib/profileColor';

	let { profiles, onSelect }: { profiles: TvState['profiles']; onSelect: (id: string) => void } =
		$props();
</script>

<div class="flex w-full max-w-sm flex-wrap items-start justify-center gap-x-6 gap-y-5">
	{#each profiles as profile, i (profile.id)}
		<button
			type="button"
			onclick={() => onSelect(profile.id)}
			in:fly|global={{ y: 24, duration: 400, delay: i * 70 }}
			class="flex w-20 flex-col items-center gap-2 focus:outline-none"
		>
			<span
				class="flex size-16 items-center justify-center overflow-hidden rounded-full"
				style="background: {profileGradient(profile.username || profile.id)}"
			>
				{#if profile.image}
					<img src={profile.image} alt="" class="size-full object-cover" />
				{:else}
					<span class="text-xl font-semibold text-white/90 uppercase">
						{profile.username.slice(0, 1)}
					</span>
				{/if}
			</span>
			<span class="max-w-full truncate text-sm font-medium text-white/90">
				{profile.username}
			</span>
		</button>
	{/each}
</div>
