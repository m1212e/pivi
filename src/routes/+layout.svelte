<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Path } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { locales, localizeHref } from '#lib/paraglide/runtime';
	import RemoteBridge from '#lib/components/RemoteBridge.svelte';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	let { children }: { children: Snippet } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if !page.url.pathname.startsWith('/remote/')}
	<!-- The phone itself renders /remote and drives the TV through it; it
	     shouldn't also join the WS room as if it were the TV. -->
	<RemoteBridge />
{/if}
{@render children()}

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Path)}>{locale}</a>
	{/each}
</div>
