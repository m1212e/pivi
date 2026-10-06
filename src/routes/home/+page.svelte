<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { profileGradient } from '#lib/profileColor';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import { appActionSchema, appActionHref } from '#lib/apps/dashboard';
	import HeroBanner from '#lib/components/HeroBanner.svelte';
	import HeroBannerEmpty from '#lib/components/HeroBannerEmpty.svelte';
	import HeroBannerSkeleton from '#lib/components/HeroBannerSkeleton.svelte';
	import VideoRow from '#lib/components/VideoRow.svelte';
	import VideoRowSkeleton from '#lib/components/VideoRowSkeleton.svelte';
	import AppsRow from '#lib/components/AppsRow.svelte';
	import { getNetworkStatus } from '#lib/state/network.svelte';
	import { pollEvery } from '#lib/poll';
	import { ambientMusic, toggleAmbientMusic } from '#lib/state/ambient.svelte';
	import { Cable, Music, VolumeX, Wifi } from '@lucide/svelte';

	// Every installed app, whatever it implements -- one that only provides
	// a screen (or nothing but playback) still gets its tile in the apps row.
	// Live, since apps are installed and removed from the paired phone while
	// this page is open. Copied into plain objects for the reason explained at
	// cardsByAppId below.
	type InstalledApp = {
		id: string;
		name: string;
		icon: string | null;
		primaryColor: string | null;
		secondaryColor: string | null;
		hasUpdate: boolean;
	};
	const toInstalled = (apps: readonly InstalledApp[]): InstalledApp[] =>
		apps.map(({ id, name, icon, primaryColor, secondaryColor, hasUpdate }) => ({
			id,
			name,
			icon,
			primaryColor,
			secondaryColor,
			hasUpdate
		}));
	const APP_FIELDS = {
		id: true,
		name: true,
		icon: true,
		primaryColor: true,
		secondaryColor: true,
		hasUpdate: true
	} as const;

	let installedApps = $state<InstalledApp[]>(
		toInstalled((await client.liveQuery.apps(APP_FIELDS)) ?? [])
	);
	const apps = $derived(
		installedApps.map((app) => ({
			id: app.id,
			name: app.name,
			href: appHref(app.id),
			icon: app.icon,
			primaryColor: app.primaryColor,
			secondaryColor: app.secondaryColor,
			hasUpdate: app.hasUpdate
		}))
	);

	const me = await client.liveQuery.me({
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

	// Real app-sourced data (see src/api/handlers/apps.ts) — proves the
	// Tier 1 dashboard contract (src/lib/apps/dashboard.ts) actually reaches
	// the real UI. Only apps that declare a dashboard show up here at all.
	// The initial value
	// comes from this top-level await (so SSR still renders real content, not
	// a loading flash); a real push subscription — not a polling setInterval
	// — keeps it live afterward, since urql's cache-first default otherwise
	// hides the fact a plain repeated query never actually sees server-side
	// changes.
	type DashboardCard = {
		id: string;
		title: string;
		subtitle: string;
		image: string;
		actionJson: string;
	};
	// A card plus which app it came from.
	type AppCard = DashboardCard & { appId: string; appName: string };
	const DASHBOARD_FIELDS = {
		appId: true,
		appName: true,
		cards: { id: true, title: true, subtitle: true, image: true, actionJson: true }
	} as const;

	function appHref(appId: string): string {
		return `/apps/${encodeURIComponent(appId)}`;
	}
	function cardHref(card: AppCard): string {
		return appActionHref(
			card.appId,
			appHref(card.appId),
			appActionSchema.parse(JSON.parse(card.actionJson))
		);
	}

	// `null` cards means that app hasn't published a dashboard at all yet
	// (still activating -- see AppDashboard in src/api/handlers/apps.ts),
	// distinct from `[]` (published, genuinely nothing to show). That race is
	// real even for this top-level await: SSR can render before an app's
	// first refresh() finishes, same as any other request.
	//
	// Copied into plain objects/arrays rather than assigned directly: what
	// liveQuery resolves to (and what .subscribe()'s callback hands back) is
	// a memoized Proxy over rumble's own internal, mutable "current data"
	// slot — the SAME object reference on every emission for a given call.
	// Reassigning $state to a reference-equal value is a no-op for Svelte's
	// reactivity, so later pushes through that proxy could silently fail to
	// invalidate $derived state depending on it (observed: the hero staying
	// stuck on its very first value while the shelf below kept updating).
	// Copying into fresh values each time guarantees a new reference.
	type DashboardResult = { appId: string; appName: string; cards?: DashboardCard[] | null }[];
	function groupCardsByAppId(dashboards: DashboardResult): Record<string, AppCard[] | null> {
		return Object.fromEntries(
			dashboards.map((d) => [
				d.appId,
				d.cards
					? d.cards.map((card) => ({
							...card,
							appId: d.appId,
							appName: d.appName
						}))
					: null
			])
		);
	}

	const initialDashboards = await client.liveQuery.appDashboards(DASHBOARD_FIELDS);
	let cardsByAppId = $state<Record<string, AppCard[] | null>>(
		groupCardsByAppId((initialDashboards ?? []) as DashboardResult)
	);
	onMount(() => {
		// .subscribe() returns an ES Observable Subscription object
		// (.unsubscribe()), not a plain unsubscribe function — returning it
		// directly as onMount's cleanup throws "not a function" the moment
		// Svelte actually calls it (client-side navigation away from /home).
		const dashboards = client.liveQuery.appDashboards(DASHBOARD_FIELDS).subscribe((value) => {
			// An emission with no data (before the first result, or on an error) says
			// nothing about the dashboards, so it must not wipe what's shown.
			if (value) cardsByAppId = groupCardsByAppId(value as DashboardResult);
		});
		const apps = client.liveQuery.apps(APP_FIELDS).subscribe((value) => {
			if (value) installedApps = toInstalled(value);
		});
		return () => {
			stopSubscription(dashboards);
			stopSubscription(apps);
		};
	});

	// An app with no entry in cardsByAppId doesn't have a dashboard at all
	// (never declared the tier), which is different from one that has but
	// hasn't published yet (entry is null). The former is just left out of
	// the shelves below instead of showing a skeleton forever.
	// Whatever the first app-with-cards' top-ranked card happens to be
	// becomes the hero — generic over whichever app's cards these are, so
	// this doesn't need touching as more apps start contributing cards.
	// Pulled out of its row so it isn't shown twice.
	const heroCard = $derived(apps.map((app) => cardsByAppId[app.id]?.[0]).find(Boolean));

	function isHeroCard(cards: AppCard[] | null, heroCard: AppCard | undefined): boolean {
		if (!cards || cards.length === 0 || !heroCard) return false;
		return cards[0].id === heroCard.id;
	}

	function shelfCardsFor(cards: AppCard[] | null, isHero: boolean): AppCard[] {
		if (!cards) return [];
		return isHero ? cards.slice(1) : cards;
	}

	function appRowFor(
		app: (typeof apps)[number],
		cards: AppCard[] | null,
		heroCard: AppCard | undefined
	) {
		const isHero = isHeroCard(cards, heroCard);
		return {
			...app,
			loading: cards === null,
			shelfCards: shelfCardsFor(cards, isHero)
		};
	}

	// Per app: whether it's still loading, and the cards to show in its shelf
	// (with the hero card, if it came from this app, excluded so it isn't
	// shown twice). An app that's still loading gets a skeleton; one that
	// settled with zero cards is left out of the shelves below entirely,
	// rather than a row titled "Suggested on {app}" for content that
	// doesn't exist.
	const appRows = $derived(
		apps
			.filter((app) => app.id in cardsByAppId)
			.map((app) => appRowFor(app, cardsByAppId[app.id], heroCard))
	);

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
		window.location.href = `/?from=${encodeURIComponent(me?.id ?? '')}`;
	}

	// Just enough to pick the wifi button's own icon (see topBar below) --
	// unlike the pre-login picker's polling, nothing here is waiting on this to
	// notice a change quickly, so a slow refresh is plenty.
	let network = $state(await getNetworkStatus());
	$effect(() =>
		pollEvery(60_000, getNetworkStatus, (next) => {
			network = next;
		})
	);

	// If nobody's touched the dashboard in a while, it's likely sitting on a
	// TV with nobody looking at the current scroll position — scroll back to
	// the top so the pairing QR overlay (+layout.svelte's PairingOverlay,
	// while no phone is connected) is there to scan.
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

<svelte:head><title>{m.app_title()}</title></svelte:head>

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
		<div class="flex items-center gap-3">
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
			<button
				type="button"
				onclick={toggleAmbientMusic}
				aria-pressed={ambientMusic.enabled}
				aria-label={m.background_music()}
				title={m.background_music()}
				class="flex size-13 items-center justify-center rounded-full bg-white/12 text-white/90 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 focus:outline-none"
			>
				{#if ambientMusic.enabled}
					<Music class="size-5" />
				{:else}
					<VolumeX class="size-5" />
				{/if}
			</button>
			<a
				href="/wifi"
				aria-label={m.wifi_open_setup()}
				title={m.wifi_open_setup()}
				class="flex size-13 items-center justify-center rounded-full bg-white/12 text-white/90 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 focus:outline-none"
			>
				{#if network.ethernet}
					<Cable class="size-5" />
				{:else}
					<Wifi class="size-5" />
				{/if}
			</a>
		</div>
	</div>
{/snippet}

{#if me}
	<div class="relative isolate flex min-h-screen flex-col gap-10 bg-slate-950 pb-16 text-white">
		<div class="pivi-aurora" aria-hidden="true">
			<span></span><span></span><span></span>
		</div>
		<div class="relative">
			{#if heroCard}
				<HeroBanner
					title={heroCard.title}
					description={heroCard.subtitle}
					image={heroCard.image}
					badge={m.featured()}
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
			<AppsRow title={m.apps()} items={apps} />
			{#each appRows as row (row.id)}
				{#if row.loading}
					<VideoRowSkeleton title={row.name} />
				{:else if row.shelfCards.length > 0}
					<VideoRow
						title={m.suggested_on({ app: row.name })}
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
