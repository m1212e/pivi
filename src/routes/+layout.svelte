<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Path } from '$app/types';
	import { resolve } from '$app/paths';
	import { onNavigate, afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Toaster } from 'svelte-sonner';
	import { locales, localizeHref } from '#lib/paraglide/runtime';
	import RemoteBridge from '#lib/components/RemoteBridge.svelte';
	import NavigationSpinner from '#lib/components/NavigationSpinner.svelte';
	import OnScreenKeyboard from '#lib/components/OnScreenKeyboard.svelte';
	import PairingOverlay from '#lib/components/PairingOverlay.svelte';
	import {
		isLoginToHome,
		loginProfileId,
		navigationPaths,
		screenKindOf,
		zoomKindBetween
	} from '#lib/screens';
	import { playSound } from '#lib/sounds';
	import { startAmbient, stopAmbient } from '#lib/ambient';
	import { ambientMusic } from '#lib/state/ambient.svelte';
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

	// The pairing QR overlay (PairingOverlay.svelte) repeats on every screen
	// except: the player (explicitly, so it never sits over video), and
	// login/the picker/register, which already show the same QR as their own
	// primary content -- an overlay on top of that would just be a duplicate.
	const hidePairingOverlay = $derived(
		screenKindOf(page.url.pathname) === 'login' || screenKindOf(page.url.pathname) === 'player'
	);

	// The actual zoom keyframes live in layout.css, keyed off this data
	// attribute, since `::view-transition-*` pseudo elements can only be
	// targeted from plain CSS, not from a component's scoped styles.
	function applyViewTransitionKind(from: string, to: string) {
		const kind = zoomKindBetween(from, to);
		if (kind) document.documentElement.dataset.viewTransition = kind;
		else delete document.documentElement.dataset.viewTransition;
	}

	// The picker ('/') is the only screen with more than one profile avatar
	// on screen at once, so a static `view-transition-name` in its own
	// markup (fine for the PIN screen and home, which each only ever show
	// one) would collide across every card there. Finding it by whichever
	// side actually names a profile id -- `to` on the way in, `from` on the
	// way back out -- picks out the one link that should actually morph,
	// tagged only for this one transition rather than permanently.
	function tagSharedProfileAvatar(from: string, to: string) {
		const id = loginProfileId(from, to);
		if (!id) return;
		document
			.querySelector<HTMLElement>(`a[href="/login/${CSS.escape(id)}"] [data-focus-ring-target]`)
			?.style.setProperty('view-transition-name', 'profile-avatar');
	}

	// `null` whenever there's nothing to transition between (a fresh load with
	// no `from`, or a browser without view transitions at all).
	function transitionPaths(navigation: Parameters<typeof navigationPaths>[0]) {
		return 'startViewTransition' in document ? navigationPaths(navigation) : null;
	}

	// Soft background music while sitting on the home screen only; it fades
	// out when leaving (to an app, the player, the picker) or when switched off
	// with the toggle in the home screen's top bar.
	const isHomePage = $derived(page.url.pathname === '/home');
	$effect(() => {
		if (!isHomePage || !ambientMusic.enabled) return;
		startAmbient();
		return stopAmbient;
	});

	// Only logging in gets the jingle, not returning to home from an app or
	// the player. The initial page load has no `from`, so it stays silent.
	afterNavigate((navigation) => {
		const paths = navigationPaths(navigation);
		if (!isRemotePage && paths && isLoginToHome(paths.from, paths.to)) playSound('home');
	});

	onNavigate((navigation) => {
		const paths = transitionPaths(navigation);
		if (!paths) return;
		const { from, to } = paths;
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
	<OnScreenKeyboard />
	<PairingOverlay hidden={hidePairingOverlay} />
{/if}
<!-- The player reads its session from the URL once, so a change of session
     (the next video of a playlist) has to mount it fresh. -->
{#key page.url.pathname.startsWith('/play/') ? page.url.pathname : ''}
	{@render children()}
{/key}

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Path)}>{locale}</a>
	{/each}
</div>
