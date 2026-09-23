<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Path } from '$app/types';
	import { resolve } from '$app/paths';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Toaster } from 'svelte-sonner';
	import { locales, localizeHref } from '#lib/paraglide/runtime';
	import RemoteBridge from '#lib/components/RemoteBridge.svelte';
	import { applyTvScale, clearTvScale } from '#lib/tvScale';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	let { children }: { children: Snippet } = $props();

	// The phone itself renders /remote and holds it up close (arm's length,
	// normal mobile web sizing) -- every other route is the TV surface,
	// viewed from across a room on whatever screen happens to be plugged in,
	// which is what actually needs to scale with resolution. Only re-runs
	// when this boolean itself flips (not on every navigation) since $effect
	// tracks the derived value, not page.url.pathname directly.
	const isRemotePage = $derived(page.url.pathname.startsWith('/remote/'));
	$effect(() => {
		if (isRemotePage) {
			clearTvScale();
			return;
		}
		applyTvScale();
		return clearTvScale;
	});

	function isHomePath(path: string): boolean {
		return path === '/home';
	}

	function isAppPath(path: string): boolean {
		return path.startsWith('/apps/');
	}

	function isLeavingAppToHome(from: string, to: string): boolean {
		return isAppPath(from) && isHomePath(to);
	}

	function isEnteringAppFromHome(from: string, to: string): boolean {
		return isHomePath(from) && isAppPath(to);
	}

	// The actual zoom keyframes live in layout.css, keyed off this data
	// attribute, since `::view-transition-*` pseudo elements can only be
	// targeted from plain CSS, not from a component's scoped styles.
	function applyViewTransitionKind(from: string, to: string) {
		if (isLeavingAppToHome(from, to)) {
			document.documentElement.dataset.viewTransition = 'zoom-out';
			return;
		}
		if (isEnteringAppFromHome(from, to)) {
			document.documentElement.dataset.viewTransition = 'zoom-in';
			return;
		}
		delete document.documentElement.dataset.viewTransition;
	}

	// Leaving an app back to the dashboard should read as "zooming out" to
	// reveal it again; going the other way (dashboard into an app) is the
	// mirror, "zooming in".
	onNavigate((navigation) => {
		if (!document.startViewTransition || !navigation.from || !navigation.to) return;
		applyViewTransitionKind(navigation.from.url.pathname, navigation.to.url.pathname);

		return new Promise((resolveTransition) => {
			document.startViewTransition(async () => {
				resolveTransition();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if !isRemotePage}
	<!-- The phone itself renders /remote and drives the TV through it; it
	     shouldn't also join the WS room as if it were the TV. -->
	<RemoteBridge />
	<!-- offset/mobileOffset are passed as rem, not svelte-sonner's own px
	     defaults, so the toaster's edge padding scales with tvScale.ts too
	     (see layout.css for the rest of its sizing, overridden there since
	     the library has no props for those). -->
	<Toaster theme="dark" position="top-right" richColors offset="1.5rem" mobileOffset="1rem" />
{/if}
{@render children()}

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Path)}>{locale}</a>
	{/each}
</div>
