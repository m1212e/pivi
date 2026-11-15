<script lang="ts">
	import { resolve } from '$app/paths';
	import { LoaderCircle } from '@lucide/svelte';
	import { ROUTES } from '#lib/routes';
	import AppIcon from '#lib/components/AppIcon.svelte';
	import type { AppInstall } from '#lib/apps/management';
	import { installFraction, installLabel } from '#lib/apps/installProgress';

	// An app still installing in the background, in the home row where its tile
	// will be. It can't be opened yet, so it leads to /apps, where the install
	// runs. No `data-pivi-app-*` attributes: the phone shouldn't offer to open it.
	let { install }: { install: AppInstall } = $props();

	const fraction = $derived(installFraction(install));
	const label = $derived(installLabel(install));

	// The ring's circumference for r = 15.9155, which makes it 100 units long so
	// the dash length is the percentage.
	const RADIUS = 100 / (2 * Math.PI);
</script>

<a
	href={resolve(ROUTES.apps)}
	title={label}
	aria-label="{install.name}: {label}"
	class="group flex w-28 shrink-0 flex-col items-center gap-2 focus:outline-none sm:w-32"
>
	<AppIcon
		id={install.id}
		name={install.name}
		icon={install.icon}
		primaryColor={install.primaryColor}
		secondaryColor={install.secondaryColor}
		data-focus-ring-target
		class="pivi-card size-20 overflow-hidden transition group-hover:scale-105 sm:size-24"
	>
		<span class="absolute inset-0 flex items-center justify-center bg-slate-950/55">
			{#if fraction === null}
				<LoaderCircle class="size-9 animate-spin text-white/90" />
			{:else}
				<svg viewBox="0 0 36 36" class="size-12 -rotate-90" aria-hidden="true">
					<circle cx="18" cy="18" r={RADIUS} fill="none" stroke-width="3" class="stroke-white/20" />
					<circle
						cx="18"
						cy="18"
						r={RADIUS}
						fill="none"
						stroke-width="3"
						stroke-linecap="round"
						pathLength="100"
						stroke-dasharray="{fraction * 100} 100"
						class="stroke-white transition-[stroke-dasharray] duration-300 ease-out"
					/>
				</svg>
				<span class="absolute text-[0.65rem] font-semibold text-white normal-case">
					{Math.round(fraction * 100)}%
				</span>
			{/if}
		</span>
	</AppIcon>
	<span class="max-w-full truncate text-xs font-medium text-white/50">{install.name}</span>
</a>
