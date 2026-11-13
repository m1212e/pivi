<script lang="ts">
	import { ROUTES, isPlayPath, isRemotePath, loginHref } from '#lib/routes';
	import { tick, type Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { LoaderCircle } from '@lucide/svelte';
	import type { Path } from '$app/types';
	import { resolve } from '$app/paths';
	import { onNavigate, afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Toaster } from 'svelte-sonner';
	import { locales, localizeHref } from '#lib/paraglide/runtime';
	import RemoteBridge from '#lib/components/RemoteBridge.svelte';
	import AppWatchdogToasts from '#lib/components/AppWatchdogToasts.svelte';
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
	import { warmPlaybackSession } from '#lib/playback/warmup';
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	let { children }: { children: Snippet } = $props();

	// The phone itself renders /remote and holds it up close (arm's length,
	// normal mobile web sizing) -- every other route is the TV surface,
	// viewed from across a room on whatever screen happens to be plugged in,
	// which is what actually needs to scale with resolution. Only re-runs
	// when this boolean itself flips (not on every navigation) since $effect
	// tracks the derived value, not page.url.pathname directly.
	const isRemotePage = $derived(isRemotePath(page.url.pathname));
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
			.querySelector<HTMLElement>(`a[href="${loginHref(CSS.escape(id))}"] [data-focus-ring-target]`)
			?.style.setProperty('view-transition-name', 'profile-avatar');
	}

	// The thumbnail a video grows out of on the way into the player, and shrinks
	// back into on the way out. Only one element may carry the name, so of
	// several links to the same session (a hero and a shelf card) the focused
	// one wins, else the first on screen. Returns it so the tag can be removed.
	function tagPlayerCard(url: URL): HTMLElement | undefined {
		const target = url.pathname + url.search;
		const links = [...document.querySelectorAll('a')].filter(
			(link) => link.pathname + link.search === target
		);
		const link = links.find((l) => l === document.activeElement) ?? links.find(isOnScreen);
		const thumbnail = link?.querySelector<HTMLElement>('[data-focus-ring-target]');
		thumbnail?.style.setProperty('view-transition-name', 'player-video');
		return thumbnail ?? undefined;
	}

	function isOnScreen(element: Element) {
		const rect = element.getBoundingClientRect();
		return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
	}

	// `null` whenever there's nothing to transition between (a fresh load with
	// no `from`, or a browser without view transitions at all).
	function transitionPaths(navigation: Parameters<typeof navigationPaths>[0]) {
		return 'startViewTransition' in document ? navigationPaths(navigation) : null;
	}

	// Soft background music while sitting on the home screen only; it fades
	// out when leaving (to an app, the player, the picker) or when switched off
	// with the toggle in the home screen's top bar.
	const isHomePage = $derived(page.url.pathname === ROUTES.home);
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

	// Set while a video grows into a black stand-in for the player, which
	// covers the wait for the app to resolve the session. Growing right on the
	// tap feels instant, the player itself could only take over after the wait.
	let launchingPlayer = $state(false);
	type OnNavigateCallback = Parameters<typeof onNavigate>[0];

	async function launchPlayer(
		navigation: Parameters<OnNavigateCallback>[0],
		from: string,
		to: string
	) {
		const card = navigation.to && tagPlayerCard(navigation.to.url);
		applyViewTransitionKind(from, to);
		const transition = document.startViewTransition(async () => {
			// Two elements sharing a name abort the whole transition.
			card?.style.removeProperty('view-transition-name');
			launchingPlayer = true;
			await tick();
		});
		const clear = () => (launchingPlayer = false);
		navigation.complete.then(clear, clear);
		const params = navigation.to?.params;
		// The player carries the name too, so it only mounts once the grow is over.
		await Promise.all([
			transition.finished,
			params?.appId && params.sessionId
				? warmPlaybackSession(params.appId, params.sessionId)
				: undefined
		]);
	}

	onNavigate((navigation) => {
		const paths = transitionPaths(navigation);
		if (!paths) return;
		const { from, to } = paths;
		// The next video of a playlist swaps in place, nothing to grow from.
		if (isPlayPath(from) && isPlayPath(to)) return;
		if (isPlayPath(to)) return launchPlayer(navigation, from, to);
		const playerUrl = isPlayPath(from) ? navigation.from?.url : undefined;
		applyViewTransitionKind(from, to);
		// Tags whichever side is currently the picker -- if it's `from`, this
		// is the only chance to tag it before its DOM is torn down.
		tagSharedProfileAvatar(from, to);

		return new Promise((resolveTransition) => {
			let playerCard: HTMLElement | undefined;
			const transition = document.startViewTransition(async () => {
				resolveTransition();
				await navigation.complete;
				// If the picker or the card is `to` instead, its DOM only exists
				// now -- tag it so the browser can find it as this transition's
				// "new" state right before that snapshot is captured.
				tagSharedProfileAvatar(from, to);
				if (playerUrl) playerCard = tagPlayerCard(playerUrl);
			});
			// A card left tagged would clash with the next one.
			transition.finished.finally(() => playerCard?.style.removeProperty('view-transition-name'));
		});
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#if !isRemotePage}
	<!-- The phone itself renders /remote and drives the TV through it; it
	     shouldn't also join the WS room as if it were the TV. -->
	<RemoteBridge />
	<AppWatchdogToasts />
	<!-- offset/mobileOffset are passed as rem, not svelte-sonner's own px
	     defaults, so the toaster's edge padding scales with tvScale.ts too
	     (see layout.css for the rest of its sizing, overridden there since
	     the library has no props for those). -->
	<Toaster theme="dark" position="top-right" richColors offset="1.5rem" mobileOffset="1rem" />
	{#if !launchingPlayer}
		<NavigationSpinner />
	{/if}
	<OnScreenKeyboard />
	<PairingOverlay hidden={hidePairingOverlay} />
{/if}
<!-- The player reads its session from the URL once, so a change of session
     (the next video of a playlist) has to mount it fresh. -->
{#key isPlayPath(page.url.pathname) ? page.url.pathname : ''}
	{@render children()}
{/key}
{#if launchingPlayer}
	<div
		class="fixed inset-0 z-40 flex items-center justify-center bg-black"
		style:view-transition-name="player-video"
	>
		<!-- Held back until the grow is over, so a quick resolve shows no spinner at all. -->
		<div in:fade={{ delay: 450, duration: 200 }}>
			<LoaderCircle class="size-12 animate-spin text-white/80" />
		</div>
	</div>
{/if}

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Path)}>{locale}</a>
	{/each}
</div>
