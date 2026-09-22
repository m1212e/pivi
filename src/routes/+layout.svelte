<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Path } from '$app/types';
	import { resolve } from '$app/paths';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Toaster } from 'svelte-sonner';
	import { locales, localizeHref } from '#lib/paraglide/runtime';
	import RemoteBridge from '#lib/components/RemoteBridge.svelte';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	let { children }: { children: Snippet } = $props();

	// Leaving an app back to the dashboard should read as "zooming out" to
	// reveal it again; going the other way (dashboard into an app) is the
	// mirror, "zooming in". The actual zoom keyframes live in layout.css,
	// keyed off this data attribute, since `::view-transition-*` pseudo
	// elements can only be targeted from plain CSS, not from a component's
	// scoped styles.
	onNavigate((navigation) => {
		if (!document.startViewTransition || !navigation.from || !navigation.to) return;

		const isHome = (path: string) => path === '/home';
		const isApp = (path: string) => path.startsWith('/apps/');
		const from = navigation.from.url.pathname;
		const to = navigation.to.url.pathname;

		if (isApp(from) && isHome(to)) {
			document.documentElement.dataset.viewTransition = 'zoom-out';
		} else if (isHome(from) && isApp(to)) {
			document.documentElement.dataset.viewTransition = 'zoom-in';
		} else {
			delete document.documentElement.dataset.viewTransition;
		}

		return new Promise((resolveTransition) => {
			document.startViewTransition(async () => {
				resolveTransition();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if !page.url.pathname.startsWith('/remote/')}
	<!-- The phone itself renders /remote and drives the TV through it; it
	     shouldn't also join the WS room as if it were the TV. -->
	<RemoteBridge />
	<Toaster theme="dark" position="top-right" richColors />
{/if}
{@render children()}

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Path)}>{locale}</a>
	{/each}
</div>
