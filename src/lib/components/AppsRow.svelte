<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
	import ContentRow from '#lib/components/ContentRow.svelte';
	import AppCard from '#lib/components/AppCard.svelte';
	import * as m from '#lib/paraglide/messages';

	let {
		title,
		items
	}: {
		title: string;
		items: {
			id: string;
			name: string;
			href: string;
			icon?: string | null;
			primaryColor?: string | null;
			secondaryColor?: string | null;
			hasUpdate?: boolean;
		}[];
	} = $props();
</script>

<ContentRow {title}>
	{#each items as app, i (app.id)}
		<div class="shrink-0" in:fly|global={{ y: 24, duration: 400, delay: i * 70 }}>
			<AppCard
				id={app.id}
				name={app.name}
				href={app.href}
				icon={app.icon}
				primaryColor={app.primaryColor}
				secondaryColor={app.secondaryColor}
				hasUpdate={app.hasUpdate}
			/>
		</div>
	{/each}

	<!-- Always the last tile: apps are installed and managed from the TV itself, so
	     there has to be somewhere a remote can reach, however many are installed. -->
	<div
		class="flex shrink-0 items-center gap-6"
		in:fly|global={{ y: 24, duration: 400, delay: items.length * 70 }}
	>
		<a
			href="/apps"
			class="group flex w-28 shrink-0 flex-col items-center gap-2 focus:outline-none sm:w-32"
		>
			<span
				data-focus-ring-target
				class="flex size-20 items-center justify-center rounded-2xl border-2 border-dashed border-white/30 text-white/60 transition group-hover:scale-105 sm:size-24"
			>
				<Plus class="size-8" />
			</span>
			<span class="truncate text-xs font-medium text-white/70">{m.apps_add()}</span>
		</a>

		{#if items.length === 0}
			<div class="flex max-w-sm flex-col gap-1">
				<span class="text-sm font-medium text-white/80">{m.apps_empty_title()}</span>
				<span class="text-xs text-white/50">{m.apps_empty_hint()}</span>
			</div>
		{/if}
	</div>
</ContentRow>
