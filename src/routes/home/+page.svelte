<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { profileGradient } from '#lib/profileColor';
	import { client } from '#lib/api/rumbleClient/client';
	import { pluginActionSchema, pluginActionHref } from '#lib/plugins/dashboard';
	import PairingQr from '#lib/components/PairingQr.svelte';
	import HeroBanner from '#lib/components/HeroBanner.svelte';
	import HeroBannerSkeleton from '#lib/components/HeroBannerSkeleton.svelte';
	import VideoRow from '#lib/components/VideoRow.svelte';
	import VideoRowSkeleton from '#lib/components/VideoRowSkeleton.svelte';
	import AppsRow from '#lib/components/AppsRow.svelte';
	import { getPairing } from '#lib/state/pairing.svelte';
	import * as m from '#lib/paraglide/messages';

	// The one real installed plugin — see plugins/youtube/manifest.ts. A
	// generic plugin registry (listing whatever's actually installed) is the
	// eventual real source for this; hardcoded here since there's exactly
	// one plugin to hardcode.
	const apps = [{ id: 'youtube', name: 'YouTube', href: '/apps/youtube' }];

	const me = await client.liveQuery.user({
		__args: { id: page.data.userId },
		id: true,
		username: true
	});
	const label = me?.username;

	// Real plugin-sourced data (see src/api/handlers/youtube.ts), alongside
	// the placeholder rows below — proves the Tier 1 dashboard contract
	// (src/lib/plugins/dashboard.ts) actually reaches the real UI. The
	// initial value comes from this top-level await (so SSR still renders
	// real content, not a loading flash); a real push subscription — not a
	// polling setInterval — keeps it live afterward, since urql's
	// cache-first default otherwise hides the fact a plain repeated query
	// never actually sees server-side changes.
	type YoutubeCard = {
		id: string;
		title: string;
		subtitle: string;
		image: string;
		appName: string;
		actionJson: string;
	};
	const YOUTUBE_CARD_FIELDS = {
		id: true,
		title: true,
		subtitle: true,
		image: true,
		appName: true,
		actionJson: true
	} as const;

	// Where a card's own app lives — the same "which app this card is from"
	// question the source badge already answers, so this doesn't need
	// generalizing further until a second plugin's cards show up alongside it.
	const YOUTUBE_APP_HREF = '/apps/youtube';
	function cardHref(card: YoutubeCard): string {
		return pluginActionHref(
			YOUTUBE_APP_HREF,
			pluginActionSchema.parse(JSON.parse(card.actionJson))
		);
	}
	// Copied into a plain array rather than assigned directly: what
	// liveQuery resolves to (and what .subscribe()'s callback hands back) is
	// a memoized Proxy over rumble's own internal, mutable "current data"
	// slot — the SAME object reference on every emission for a given call.
	// Reassigning $state to a reference-equal value is a no-op for Svelte's
	// reactivity, so later pushes through that proxy could silently fail to
	// invalidate $derived state depending on it (observed: the hero staying
	// stuck on its very first value while the shelf below kept updating).
	// Spreading into a fresh array each time guarantees a new reference.
	let youtubeCards = $state<YoutubeCard[]>([
		...(await client.liveQuery.youtubeDashboard(YOUTUBE_CARD_FIELDS))
	]);
	onMount(() => {
		// .subscribe() returns an ES Observable Subscription object
		// (.unsubscribe()), not a plain unsubscribe function — returning it
		// directly as onMount's cleanup throws "not a function" the moment
		// Svelte actually calls it (client-side navigation away from /home).
		const subscription = client.liveQuery
			.youtubeDashboard(YOUTUBE_CARD_FIELDS)
			.subscribe((value) => {
				youtubeCards = value ? [...value] : [];
			});
		return () => subscription.unsubscribe();
	});

	// Whatever the dashboard's top-ranked card happens to be becomes the hero
	// — generic over whichever plugin's cards these are, so this doesn't
	// need touching as more plugins start contributing cards. Pulled out of
	// its row so it isn't shown twice.
	const heroCard = $derived(youtubeCards[0]);
	const shelfCards = $derived(youtubeCards.slice(1));

	async function signOut() {
		await client.mutate.signOut();
		await goto('/');
	}

	// Same short-lived-token refresh as the profile-select screen — the
	// dashboard can also sit idle long enough for the pairing code to expire.
	let pairing = $state(await getPairing());
	$effect(() => {
		const interval = setInterval(async () => {
			pairing = await getPairing();
		}, 60_000);
		return () => clearInterval(interval);
	});

	// If nobody's touched the dashboard in a while, it's likely sitting on a
	// TV with nobody looking at the current scroll position — scroll back to
	// the top so the pairing QR code (in the top bar) is there to scan.
	// `focusin`/`click`/`keydown` cover both a phone remote's swipes/taps
	// (RemoteBridge turns those into real focus/click events) and any direct
	// interaction with the TV itself.
	const IDLE_TIMEOUT_MS = 2 * 60 * 1000;
	$effect(() => {
		let timeout: ReturnType<typeof setTimeout>;
		const scrollToTopWhenIdle = () => {
			clearTimeout(timeout);
			timeout = setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), IDLE_TIMEOUT_MS);
		};

		const activityEvents = ['focusin', 'click', 'keydown'] as const;
		for (const event of activityEvents) document.addEventListener(event, scrollToTopWhenIdle);
		scrollToTopWhenIdle();

		return () => {
			clearTimeout(timeout);
			for (const event of activityEvents) document.removeEventListener(event, scrollToTopWhenIdle);
		};
	});
</script>

<svelte:head><title>Pivi</title></svelte:head>

{#if me}
	<div class="flex min-h-screen flex-col gap-10 bg-slate-950 pb-16 text-white">
		<div class="relative">
			{#if heroCard}
				<HeroBanner
					title={heroCard.title}
					description={heroCard.subtitle}
					image={heroCard.image}
					badge="Featured"
					source={heroCard.appName}
					href={cardHref(heroCard)}
				/>
			{:else}
				<!-- The youtube plugin always eventually falls back to trending
				     even when signed out, so no heroCard yet just means the
				     plugin is still activating/fetching. -->
				<HeroBannerSkeleton />
			{/if}

			<div
				data-pivi-top-bar
				class="absolute inset-x-0 top-0 flex items-start justify-between px-8 pt-6 sm:px-12"
				transition:fade={{ duration: 400, delay: 150 }}
			>
				<button
					type="button"
					onclick={signOut}
					class="flex items-center gap-3 rounded-full bg-white/12 py-2 pr-5 pl-2 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 focus:outline-none"
				>
					<span
						data-focus-ring-target
						class="flex size-9 items-center justify-center overflow-hidden rounded-full"
						style="background: {profileGradient(me.username ?? me.id)}"
					>
						<span class="text-sm font-semibold text-white/90 uppercase">
							{label?.slice(0, 1)}
						</span>
					</span>
					<span class="text-sm font-medium text-white/90">{label}</span>
				</button>

				<div class="flex flex-col items-end gap-4">
					{#if pairing.remoteUrl}
						<div
							class="rounded-3xl bg-white/12 p-3 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
						>
							<PairingQr url={pairing.remoteUrl} size={220} />
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="flex flex-col gap-10">
			<AppsRow title="Apps" items={apps} />
			{#if youtubeCards.length === 0}
				<!-- The youtube plugin always eventually falls back to trending
				     even when signed out, so an empty result here means the
				     plugin is still activating/fetching, not "nothing to show". -->
				<VideoRowSkeleton title="Suggested on YouTube" />
			{:else if shelfCards.length > 0}
				<VideoRow
					title="Suggested on YouTube"
					items={shelfCards.map((c) => ({
						id: c.id,
						title: c.title,
						meta: c.subtitle,
						image: c.image,
						href: cardHref(c)
					}))}
				/>
				<!-- Temporary: same cards reshuffled into extra rows so there's
				     enough below the fold to actually see the scroll-triggered
				     unfold animation. Remove once there's real second/third rows
				     of plugin-sourced content. -->
				<VideoRow
					title="More like this"
					items={[...shelfCards].reverse().map((c) => ({
						id: `more-${c.id}`,
						title: c.title,
						meta: c.subtitle,
						image: c.image,
						href: cardHref(c)
					}))}
				/>
				<VideoRow
					title="Because you watched YouTube"
					items={shelfCards
						.map((c, i, arr) => arr[(i + 1) % arr.length])
						.map((c) => ({
							id: `because-${c.id}`,
							title: c.title,
							meta: c.subtitle,
							image: c.image,
							href: cardHref(c)
						}))}
				/>
			{/if}
		</div>
	</div>
{/if}
