<script lang="ts">
	import { appAccentGradient } from '#lib/appAccent';
	import { appIconDataUrl } from '#lib/apps/manifest';
	import * as m from '#lib/paraglide/messages';

	let {
		id,
		name,
		href,
		icon = null,
		primaryColor = null,
		secondaryColor = null,
		hasUpdate = false
	}: {
		id: string;
		name: string;
		href: string;
		icon?: string | null;
		primaryColor?: string | null;
		secondaryColor?: string | null;
		hasUpdate?: boolean;
	} = $props();

	const gradient = $derived(appAccentGradient(id, primaryColor, secondaryColor));
</script>

<a
	{href}
	data-pivi-app-id={id}
	data-pivi-app-name={name}
	data-pivi-app-icon={icon || undefined}
	data-pivi-app-primary-color={primaryColor || undefined}
	data-pivi-app-secondary-color={secondaryColor || undefined}
	class="group flex w-28 shrink-0 flex-col items-center gap-2 focus:outline-none sm:w-32"
>
	<span
		data-focus-ring-target
		class="pivi-card relative flex size-20 items-center justify-center rounded-2xl text-lg font-semibold text-white/90 uppercase transition group-hover:scale-105 sm:size-24"
		style="background: {gradient}; --pivi-glow: {gradient}"
	>
		{#if icon}
			<img src={appIconDataUrl(icon)} alt="" class="size-10 object-contain" />
		{:else}
			{name.slice(0, 1)}
		{/if}
		{#if hasUpdate}
			<!-- A plain dot, not a count or a "Update available" label spelled
			     out on the tile itself -- the icon is too small for text, and
			     the point is just to catch the eye enough to open the app (or
			     /apps) to see what it is. -->
			<span
				title={m.apps_update_badge()}
				aria-label={m.apps_update_badge()}
				class="absolute -top-1 -right-1 size-4 rounded-full bg-indigo-400 ring-2 ring-slate-950 sm:size-5"
			></span>
		{/if}
	</span>
	<span class="truncate text-xs font-medium text-white/70">{name}</span>
</a>
