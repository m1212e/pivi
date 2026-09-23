<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { page } from '$app/state';
	import { profileGradient } from '#lib/profileColor';
	import { client } from '#lib/api/rumbleClient/client';
	import { pluginActionSchema, pluginActionHref } from '#lib/plugins/dashboard';
	import PairingQr from '#lib/components/PairingQr.svelte';
	import HeroBanner from '#lib/components/HeroBanner.svelte';
	import HeroBannerEmpty from '#lib/components/HeroBannerEmpty.svelte';
	import HeroBannerSkeleton from '#lib/components/HeroBannerSkeleton.svelte';
	import VideoRow from '#lib/components/VideoRow.svelte';
	import VideoRowSkeleton from '#lib/components/VideoRowSkeleton.svelte';
	import PlaceholderRow from '#lib/components/PlaceholderRow.svelte';
	import AppsRow from '#lib/components/AppsRow.svelte';
	import { getPairing } from '#lib/state/pairing.svelte';

	// The one real installed plugin — see plugins/youtube/manifest.ts. A
	// generic plugin registry (listing whatever's actually installed) is the
	// eventual real source for this; hardcoded here since there's exactly
	// one plugin to hardcode.
	const apps = [{ id: 'youtube', name: 'YouTube', href: '/apps/youtube' }];

	const me = await client.liveQuery.user({
		__args: { id: page.data.userId },
		id: true,
		username: true,
		image: true
	});
	const label = me?.username;
	// Named separately (rather than `NonNullable<typeof me>` written inline
	// where it's needed, in topBar's own snippet parameter below) since that
	// snippet's parameter is also named `me`, shadowing this one in the same
	// scope its own type annotation would otherwise need to reference.
	type Profile = NonNullable<typeof me>;

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
			'youtube',
			YOUTUBE_APP_HREF,
			pluginActionSchema.parse(JSON.parse(card.actionJson))
		);
	}
	// `null` means the plugin hasn't published a dashboard at all yet (still
	// activating -- see resolveDashboard's comment in
	// src/api/handlers/youtube.ts), distinct from `[]` (published, genuinely
	// nothing to show). That race is real even for this top-level await: SSR
	// can render before the plugin's first refresh() finishes, same as any
	// other request.
	//
	// Copied into a plain array rather than assigned directly: what
	// liveQuery resolves to (and what .subscribe()'s callback hands back) is
	// a memoized Proxy over rumble's own internal, mutable "current data"
	// slot — the SAME object reference on every emission for a given call.
	// Reassigning $state to a reference-equal value is a no-op for Svelte's
	// reactivity, so later pushes through that proxy could silently fail to
	// invalidate $derived state depending on it (observed: the hero staying
	// stuck on its very first value while the shelf below kept updating).
	// Spreading into a fresh array each time guarantees a new reference.
	const initialYoutubeDashboard = await client.liveQuery.youtubeDashboard(YOUTUBE_CARD_FIELDS);
	let youtubeCards = $state<YoutubeCard[] | null>(
		initialYoutubeDashboard ? [...initialYoutubeDashboard] : null
	);
	onMount(() => {
		// .subscribe() returns an ES Observable Subscription object
		// (.unsubscribe()), not a plain unsubscribe function — returning it
		// directly as onMount's cleanup throws "not a function" the moment
		// Svelte actually calls it (client-side navigation away from /home).
		const subscription = client.liveQuery
			.youtubeDashboard(YOUTUBE_CARD_FIELDS)
			.subscribe((value) => {
				youtubeCards = value ? [...value] : null;
			});
		return () => subscription.unsubscribe();
	});

	// Each app's contributed cards, keyed by app id — the one thing here
	// that's still hardcoded, since youtubeDashboard is the only per-plugin
	// query that exists today (see plugins/dashboard.ts's dashboardContributionSchema
	// comment: a generic aggregator is the eventual real source). Everything
	// downstream of this map — which rows render skeleton/placeholder/real
	// content — is generic over however many entries end up in it.
	const cardsByAppId = $derived<Record<string, YoutubeCard[] | null>>({ youtube: youtubeCards });

	// Whatever the first app-with-cards' top-ranked card happens to be
	// becomes the hero — generic over whichever plugin's cards these are, so
	// this doesn't need touching as more plugins start contributing cards.
	// Pulled out of its row so it isn't shown twice.
	const heroCard = $derived(apps.map((app) => cardsByAppId[app.id]?.[0]).find(Boolean));

	function isHeroCard(cards: YoutubeCard[] | null, heroCard: YoutubeCard | undefined): boolean {
		if (!cards || cards.length === 0 || !heroCard) return false;
		return cards[0].id === heroCard.id;
	}

	function hasCards(cards: YoutubeCard[] | null): boolean {
		return !!cards && cards.length > 0;
	}

	function shelfCardsFor(cards: YoutubeCard[] | null, isHero: boolean): YoutubeCard[] {
		if (!cards) return [];
		return isHero ? cards.slice(1) : cards;
	}

	function appRowFor(
		app: (typeof apps)[number],
		cards: YoutubeCard[] | null,
		heroCard: YoutubeCard | undefined
	) {
		const isHero = isHeroCard(cards, heroCard);
		return {
			...app,
			loading: cards === null,
			hasContent: hasCards(cards),
			shelfCards: shelfCardsFor(cards, isHero)
		};
	}

	// Per app: whether it's still loading, whether it settled with any
	// content, and the cards to show in its shelf (with the hero card, if it
	// came from this app, excluded so it isn't shown twice). An app that's
	// still loading gets a skeleton; one that settled with zero cards gets an
	// explanatory placeholder instead of a row titled "Suggested on {app}"
	// for content that doesn't exist.
	const appRows = $derived(apps.map((app) => appRowFor(app, cardsByAppId[app.id], heroCard)));

	// True once every app has published something (even an empty result) --
	// used to decide whether a missing hero means "still loading" or "no app
	// has anything to show."
	const dashboardLoading = $derived(appRows.some((row) => row.loading));

	async function signOut() {
		await client.mutate.signOut();
		// A full navigation, not goto()'s client-side routing -- switching
		// profiles should leave nothing of the previous session behind (urql's
		// cache, this page's own $state, any other module-level client state),
		// and the only way to guarantee that without hunting down every place
		// that might hold some is to tear down the whole JS runtime.
		//
		// `from` tells the picker which profile this was so it can statically
		// tag that one avatar's `view-transition-name` for the shared-element
		// morph -- a full reload has no JS state to hand that off with
		// otherwise (unlike the same-document picker->PIN transition, which
		// +layout.svelte tags dynamically), and the picker shows many avatars
		// at once so it can't just tag one unconditionally the way the PIN and
		// home pages (each showing only one) already do.
		window.location.href = `/?from=${encodeURIComponent(me.id)}`;
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

<!-- A genuine top-level snippet (fallow scores one of these as its own
     complexity unit, separate from the page's own <template>) rather than
     one nested inside the `{#if me}` below -- `me` is only ever non-null
     when this actually renders, so it's taken as a parameter instead of
     relying on the outer block's own narrowing, which a nested snippet
     wouldn't have inherited anyway. -->
{#snippet topBar(me: Profile)}
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
				style:view-transition-name="profile-avatar"
			>
				{#if me.image}
					<img src={me.image} alt="" class="size-full object-cover" />
				{:else}
					<span class="text-sm font-semibold text-white/90 uppercase">
						{label?.slice(0, 1)}
					</span>
				{/if}
			</span>
			<span class="text-sm font-medium text-white/90">{label}</span>
		</button>

		<div class="flex flex-col items-end gap-4">
			{#if pairing.remoteUrl}
				<div
					class="rounded-3xl bg-white/12 p-3 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
				>
					<div style:view-transition-name="pairing-qr">
						<PairingQr url={pairing.remoteUrl} size={220} />
					</div>
				</div>
			{/if}
		</div>
	</div>
{/snippet}

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
			{:else if dashboardLoading}
				<HeroBannerSkeleton />
			{:else}
				<HeroBannerEmpty />
			{/if}

			{@render topBar(me)}
		</div>

		<div class="flex flex-col gap-10">
			<AppsRow title="Apps" items={apps} />
			{#each appRows as row (row.id)}
				{#if row.loading}
					<VideoRowSkeleton title={row.name} />
				{:else if !row.hasContent}
					<PlaceholderRow appName={row.name} appHref={row.href} />
				{:else if row.shelfCards.length > 0}
					<VideoRow
						title="Suggested on {row.name}"
						items={row.shelfCards.map((c) => ({
							id: c.id,
							title: c.title,
							meta: c.subtitle,
							image: c.image,
							href: cardHref(c)
						}))}
					/>
				{/if}
			{/each}
		</div>
	</div>
{/if}
