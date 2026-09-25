<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Path } from '$app/types';
	import { resolve } from '$app/paths';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Toaster } from 'svelte-sonner';
	import { locales, localizeHref } from '#lib/paraglide/runtime';
	import RemoteBridge from '#lib/components/RemoteBridge.svelte';
	import NavigationSpinner from '#lib/components/NavigationSpinner.svelte';
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

	// A lookup table rather than an if-chain: each predicate below is its own
	// small, independently-simple unit instead of one function shouldering
	// every path's worth of branching.
	const SCREEN_MATCHERS: [ScreenKind, (path: string) => boolean][] = [
		['home', (path) => path === '/home'],
		['app', (path) => path.startsWith('/apps/')],
		['player', (path) => path.startsWith('/play/')],
		['login', (path) => path === '/' || path.startsWith('/login') || path.startsWith('/register')]
	];

	function screenKindOf(path: string): ScreenKind | null {
		return SCREEN_MATCHERS.find(([, matches]) => matches(path))?.[0] ?? null;
	}

	// How "deep" each screen sits, purely to pick a zoom direction -- login
	// is the outermost, home opens from it, an app opens from home, and the
	// player can open from either home or an app's own screen (see
	// #lib/plugins/dashboard's pluginActionHref), so it sits one deeper still.
	const SCREEN_DEPTH: Record<ScreenKind, number> = { login: 0, home: 1, app: 2, player: 3 };

	// The actual zoom keyframes live in layout.css, keyed off this data
	// attribute, since `::view-transition-*` pseudo elements can only be
	// targeted from plain CSS, not from a component's scoped styles. The
	// 3-way guard (either side unknown, or both the same) plus the
	// direction ternary is one irreducible decision -- splitting it up would
	// only relocate the same branches under a new name, not actually reduce
	// them.
	// fallow-ignore-next-line complexity
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

	// Split from tagSharedProfileAvatar below purely so each half stays a
	// single, simple decision instead of the two piling up in one function.
	function loginProfileId(from: string, to: string): string | undefined {
		return to.match(LOGIN_PATH)?.[1] ?? from.match(LOGIN_PATH)?.[1];
	}

	function tagSharedProfileAvatar(from: string, to: string) {
		const id = loginProfileId(from, to);
		if (!id) return;
		document
			.querySelector<HTMLElement>(`a[href="/login/${CSS.escape(id)}"] [data-focus-ring-target]`)
			?.style.setProperty('view-transition-name', 'profile-avatar');
	}

	// Moving to a deeper screen (e.g. dashboard into an app) reads as
	// "zooming in"; moving back out (that app's own back button to the
	// dashboard) is the mirror, "zooming out".
	onNavigate((navigation) => {
		if (!document.startViewTransition || !navigation.from || !navigation.to) return;
		const from = navigation.from.url.pathname;
		const to = navigation.to.url.pathname;
		// Opening the player can take a real network round trip resolving the
		// session before its own top-level await settles (see
		// NavigationSpinner.svelte). A view transition only ever renders its
		// before/after snapshots, never whatever the live DOM does in between --
		// so wrapping that wait in one would hide the spinner behind a frozen
		// copy of the old screen for the whole delay, then swap straight to the
		// finished player with no zoom at all. Skipping the transition for this
		// one destination trades away its zoom-in for the spinner actually
		// being visible while the session resolves.
		if (to.startsWith('/play/')) return;
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
	<NavigationSpinner />
{/if}
{@render children()}

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Path)}>{locale}</a>
	{/each}
</div>
