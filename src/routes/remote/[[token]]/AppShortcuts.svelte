<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { appAccentGradient } from '#lib/appAccent';
	import { appIconDataUrl } from '#lib/apps/manifest';
	import type { TvState } from '#lib/pairing/remoteController.svelte';

	let { apps, onSelect }: { apps: TvState['apps']; onSelect: (id: string) => void } = $props();
</script>

<!-- The home dashboard's own first few apps, shown above the trackpad rather
     than as a tab of their own, since the dashboard is still the trackpad's
     home turf. -->
{#if apps.length > 0}
	<div class="mb-4 flex w-full max-w-sm justify-center gap-4" transition:fade={{ duration: 200 }}>
		{#each apps as app, i (app.id)}
			<button
				type="button"
				onclick={() => onSelect(app.id)}
				in:fly|global={{ y: 24, duration: 400, delay: i * 70 }}
				class="flex w-20 flex-col items-center gap-2 focus:outline-none"
			>
				<span
					class="flex size-14 items-center justify-center rounded-2xl text-lg font-semibold text-white/90 uppercase"
					style="background: {appAccentGradient(app.id, app.primaryColor, app.secondaryColor)}"
				>
					{#if app.icon}
						<img src={appIconDataUrl(app.icon)} alt="" class="size-8 object-contain" />
					{:else}
						{app.name.slice(0, 1)}
					{/if}
				</span>
				<span class="max-w-full truncate text-xs font-medium text-white/70">{app.name}</span>
			</button>
		{/each}
	</div>
{/if}
