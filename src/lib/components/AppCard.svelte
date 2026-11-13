<script lang="ts">
	import { pushState } from '$app/navigation';
	import AppIcon from '#lib/components/AppIcon.svelte';
	import * as m from '#lib/paraglide/messages';

	// An installed app's tile on the dashboard. AppIcon only draws the tile, so
	// this adds the link and label. The `data-pivi-app-*` attributes are read by
	// RemoteBridge to show the apps on the phone and to click one when the
	// phone picks it.
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

	// Asks first instead of opening (AppUpdatePrompt, shown by AppsRow). Kept as
	// shallow history state so the remote's back button closes the prompt
	// rather than leaving the home screen.
	function askFirst(event: MouseEvent) {
		if (!hasUpdate) return;
		event.preventDefault();
		pushState('', { appUpdatePrompt: id });
	}
</script>

<a
	{href}
	onclick={askFirst}
	data-pivi-app-id={id}
	data-pivi-app-name={name}
	data-pivi-app-icon={icon || undefined}
	data-pivi-app-primary-color={primaryColor || undefined}
	data-pivi-app-secondary-color={secondaryColor || undefined}
	class="group flex w-28 shrink-0 flex-col items-center gap-2 focus:outline-none sm:w-32"
>
	<AppIcon
		{id}
		{name}
		{icon}
		{primaryColor}
		{secondaryColor}
		data-focus-ring-target
		class="pivi-card size-20 transition group-hover:scale-105 sm:size-24"
	>
		{#if hasUpdate}
			<!-- A plain dot, not a count or a "Update available" label spelled
			     out on the tile itself -- the icon is too small for text, and
			     opening the app asks about it anyway. -->
			<span
				title={m.apps_update_badge()}
				aria-label={m.apps_update_badge()}
				class="absolute -top-1 -right-1 size-4 rounded-full bg-indigo-400 ring-2 ring-slate-950 sm:size-5"
			></span>
		{/if}
	</AppIcon>
	<span class="truncate text-xs font-medium text-white/70">{name}</span>
</a>
