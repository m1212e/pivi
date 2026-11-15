<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Path } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ROUTES, appHref, appUpdateHref } from '#lib/routes';
	import { Plus } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import ContentRow from '#lib/components/ContentRow.svelte';
	import AppCard from '#lib/components/AppCard.svelte';
	import PendingAppCard from '#lib/components/PendingAppCard.svelte';
	import type { AppInstall } from '#lib/apps/management';
	import AppUpdatePrompt from '#lib/components/AppUpdatePrompt.svelte';
	import * as m from '#lib/paraglide/messages';

	// The dashboard's row of installed apps. Separate from VideoRow because its
	// tiles are apps, and it always ends with the add-app entry.
	let {
		title,
		items,
		pending = []
	}: {
		title: string;
		// Apps still installing in the background, shown after the installed ones.
		pending?: AppInstall[];
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

	const prompted = $derived(items.find((app) => app.id === page.state.appUpdatePrompt));

	// Installed apps and installs in flight in one list keyed by app id, so an
	// install that finishes turns its pending tile into the app's tile in place
	// (sliding over if the app sorts somewhere else) instead of one tile
	// vanishing and another flying in, with every tile after it re-rendering.
	type Tile =
		| { kind: 'app'; id: string; app: (typeof items)[number] }
		| { kind: 'pending'; id: string; install: AppInstall };
	const tiles = $derived<Tile[]>([
		...items.map((app) => ({ kind: 'app' as const, id: app.id, app })),
		...pending.map((install) => ({ kind: 'pending' as const, id: install.id, install }))
	]);

	// The staggered reveal is for the row's first render. A tile that shows up
	// later (an install starting) just flies in on its own, without waiting
	// for its position's share of a stagger nobody else is part of. Not tied to
	// mount: ContentRow only renders the tiles once the row scrolls into view,
	// and every first-batch intro starts in that same flush.
	let revealed = false;
	const revealDelay = (index: number) => (revealed ? 0 : index * 70);
	const onReveal = () => setTimeout(() => (revealed = true));
</script>

<ContentRow {title}>
	{#each tiles as tile, i (tile.id)}
		<div
			class="shrink-0"
			in:fly|global={{ y: 24, duration: 400, delay: revealDelay(i) }}
			animate:flip={{ duration: 300 }}
			onintrostart={onReveal}
		>
			{#if tile.kind === 'app'}
				<AppCard
					id={tile.app.id}
					name={tile.app.name}
					href={tile.app.href}
					icon={tile.app.icon}
					primaryColor={tile.app.primaryColor}
					secondaryColor={tile.app.secondaryColor}
					hasUpdate={tile.app.hasUpdate}
				/>
			{:else}
				<PendingAppCard install={tile.install} />
			{/if}
		</div>
	{/each}

	<!-- Always the last tile: apps are installed and managed from the TV itself, so
	     there has to be somewhere a remote can reach, however many are installed. -->
	<div
		class="flex shrink-0 items-center gap-6"
		in:fly|global={{ y: 24, duration: 400, delay: revealDelay(tiles.length) }}
		onintrostart={onReveal}
	>
		<a
			href={resolve(ROUTES.apps)}
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

		{#if items.length === 0 && pending.length === 0}
			<div class="flex max-w-sm flex-col gap-1">
				<span class="text-sm font-medium text-white/80">{m.apps_empty_title()}</span>
				<span class="text-xs text-white/50">{m.apps_empty_hint()}</span>
			</div>
		{/if}
	</div>
</ContentRow>

<!-- Both choices replace the prompt's history entry, so going back from the
     app or /apps doesn't bring the prompt up again. -->
{#if prompted}
	<AppUpdatePrompt
		name={prompted.name}
		onUpdate={() => goto(resolve(appUpdateHref(prompted.id) as Path), { replaceState: true })}
		onOpen={() => goto(resolve(appHref(prompted.id) as Path), { replaceState: true })}
	/>
{/if}
