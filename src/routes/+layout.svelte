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

	// Every route this app actually navigates *between* (as opposed to a
	// transient step like /oauth/callback) is one of these four "screens" --
	// each gets the same zoom treatment moving to/from any of the others, not
	// just the one app<->home pair this originally shipped with. `null` (e.g.
	// /remote, /oauth/callback) means "not a screen with its own zoom
	// identity" -- no transition applies there either way.
	type ScreenKind = 'login' | 'home' | 'app' | 'player';

	function screenKindOf(path: string): ScreenKind | null {
		if (path === '/home') return 'home';
		if (path.startsWith('/apps/')) return 'app';
		if (path.startsWith('/play/')) return 'player';
		if (path === '/' || path.startsWith('/login') || path.startsWith('/register')) return 'login';
		return null;
	}

	// How "deep" each screen sits, purely to pick a zoom direction -- login
	// is the outermost, home opens from it, an app opens from home, and the
	// player can open from either home or an app's own screen (see
	// #lib/plugins/dashboard's pluginActionHref), so it sits one deeper still.
	const SCREEN_DEPTH: Record<ScreenKind, number> = { login: 0, home: 1, app: 2, player: 3 };

	// The actual zoom keyframes live in layout.css, keyed off this data
	// attribute, since `::view-transition-*` pseudo elements can only be
	// targeted from plain CSS, not from a component's scoped styles.
	function applyViewTransitionKind(from: string, to: string) {
		const fromKind = screenKindOf(from);
		const toKind = screenKindOf(to);
		if (!fromKind || !toKind || fromKind === toKind) {
			delete document.documentElement.dataset.viewTransition;
			return;
		}
		document.documentElement.dataset.viewTransition =
			SCREEN_DEPTH[toKind] > SCREEN_DEPTH[fromKind] ? 'zoom-in' : 'zoom-out';
	}

	// The picker ('/') is the only screen with more than one profile avatar
	// on screen at once, so a static `view-transition-name` in its own
	// markup (fine for the PIN screen and home, which each only ever show
	// one) would collide across every card there. Finding it by whichever
	// side actually names a profile id -- `to` on the way in, `from` on the
	// way back out -- picks out the one link that should actually morph,
	// tagged only for this one transition rather than permanently.
	const LOGIN_PATH = /^\/login\/([^/]+)$/;

	function tagSharedProfileAvatar(from: string, to: string) {
		const id = to.match(LOGIN_PATH)?.[1] ?? from.match(LOGIN_PATH)?.[1];
		if (!id) return;
		const avatar = document.querySelector<HTMLElement>(
			`a[href="/login/${CSS.escape(id)}"] [data-focus-ring-target]`
		);
		if (avatar) avatar.style.viewTransitionName = 'profile-avatar';
	}

	// Moving to a deeper screen (e.g. dashboard into an app) reads as
	// "zooming in"; moving back out (that app's own back button to the
	// dashboard) is the mirror, "zooming out".
	onNavigate((navigation) => {
		if (!document.startViewTransition || !navigation.from || !navigation.to) return;
		const from = navigation.from.url.pathname;
		const to = navigation.to.url.pathname;
		applyViewTransitionKind(from, to);
		// Tags whichever side is currently the picker -- if it's `from`, this
		// is the only chance to tag it before its DOM is torn down.
		tagSharedProfileAvatar(from, to);

		return new Promise((resolveTransition) => {
			document.startViewTransition(async () => {
				resolveTransition();
				await navigation.complete;
				// If the picker is `to` instead, its DOM only exists now --
				// tag it again so the browser can find it as this transition's
				// "new" state right before that snapshot is captured.
				tagSharedProfileAvatar(from, to);
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
