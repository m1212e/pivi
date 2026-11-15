<script lang="ts">
	import { resolve } from '$app/paths';
	import { ROUTES, appHref } from '#lib/routes';
	import * as m from '#lib/paraglide/messages';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { profileGradient } from '#lib/profileColor';
	import { client } from '#lib/api/rumbleClient/client';
	import { followLive } from '#lib/api/subscription';
	import { freshQuery } from '#lib/api/freshQuery';
	import { appActionSchema } from '@pivi/sdk/dashboard';
	import { appActionHref } from '#lib/apps/actionHref';
	import { appInstallSchema, type AppInstall } from '#lib/apps/management';
	import HeroBanner from '#lib/components/HeroBanner.svelte';
	import HeroBannerEmpty from '#lib/components/HeroBannerEmpty.svelte';
	import HeroBannerSkeleton from '#lib/components/HeroBannerSkeleton.svelte';
	import VideoRow from '#lib/components/VideoRow.svelte';
	import VideoRowSkeleton from '#lib/components/VideoRowSkeleton.svelte';
	import AppsRow from '#lib/components/AppsRow.svelte';
	import LanguagePicker from '#lib/components/LanguagePicker.svelte';
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
		toInstalled((await freshQuery.apps(APP_FIELDS)) ?? [])
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

	// Installs running in the background (started on /apps or from the phone),
	// shown as pending tiles with their progress until the app is in. Copied
	// and parsed for the same reason as the dashboards below.
	const INSTALL_FIELDS = {
		id: true,
		name: true,
		version: true,
		icon: true,
		primaryColor: true,
		secondaryColor: true,
		phase: true,
		downloadedBytes: true,
		totalBytes: true
	} as const;
	const toInstalls = (value: unknown): AppInstall[] => {
		const parsed = appInstallSchema.array().safeParse(JSON.parse(JSON.stringify(value ?? [])));
		return parsed.success ? parsed.data : [];
	};
	let pendingInstalls = $state<AppInstall[]>(
		toInstalls(await freshQuery.appInstalls(INSTALL_FIELDS).catch(() => []))
	);
	// An app whose install just finished can show up in both lists for one push.
	const pending = $derived(
		pendingInstalls.filter((install) => !installedApps.some((app) => app.id === install.id))
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
	// Tier 1 dashboard contract (sdk/dashboard.ts) actually reaches
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
		fallbackImage: string | null;
		actionJson: string;
	};
	// A card plus which app it came from.
	type AppCard = DashboardCard & { appId: string; appName: string };
	const DASHBOARD_FIELDS = {
		appId: true,
		appName: true,
		cards: {
			id: true,
			title: true,
			subtitle: true,
			image: true,
			fallbackImage: true,
			actionJson: true
		}
	} as const;

	// A home card is always a link, so one whose action has none (opening
	// something on the phone) leads to the app's page instead.
	function cardHref(card: AppCard): string {
		const action = appActionSchema.parse(JSON.parse(card.actionJson));
		return appActionHref(card.appId, action) ?? appHref(card.appId);
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

	// Fresh rather than from urql's cache, which holds what the last visit saw
	// (see followLive below).
	const initialDashboards = await freshQuery.appDashboards(DASHBOARD_FIELDS);
	let cardsByAppId = $state<Record<string, AppCard[] | null>>(
		groupCardsByAppId((initialDashboards ?? []) as DashboardResult)
	);
	// Pushes only, never a cached replay, see followLive. An emission with no
	// data (an error) says nothing about the lists, so it never wipes them.
	onMount(() => {
		const stops = [
			followLive(
				(onValue) => client.subscribe.appDashboards(DASHBOARD_FIELDS).subscribe(onValue),
				() => freshQuery.appDashboards(DASHBOARD_FIELDS),
				(value) => (cardsByAppId = groupCardsByAppId(value as DashboardResult))
			),
			followLive<readonly InstalledApp[]>(
				(onValue) => client.subscribe.apps(APP_FIELDS).subscribe(onValue),
				() => freshQuery.apps(APP_FIELDS),
				(value) => (installedApps = toInstalled(value))
			),
			followLive(
				(onValue) => client.subscribe.appInstalls(INSTALL_FIELDS).subscribe(onValue),
				() => freshQuery.appInstalls(INSTALL_FIELDS),
				(value) => (pendingInstalls = toInstalls(value))
			)
		];
		return () => stops.forEach((stop) => stop());
	});

	// An app with no entry in cardsByAppId doesn't have a dashboard at all
	// (never declared the tier), which is different from one that has but
	// hasn't published yet (entry is null). The former is just left out of
	// the shelves below instead of showing a skeleton forever.
	// The hero takes turns between the installed apps and their top cards:
	// each app's first, then each app's second, and so on, up to
	// HERO_CARDS_PER_APP each, the apps in the order of the apps row (most
	// recently used first). Generic over whichever apps contribute, so nothing
	// here changes as more do.
	const HERO_CARDS_PER_APP = 5;
	const heroCandidates = $derived.by(() => {
		const perApp = apps.map((app) => (cardsByAppId[app.id] ?? []).slice(0, HERO_CARDS_PER_APP));
		const turns: AppCard[] = [];
		for (let rank = 0; rank < HERO_CARDS_PER_APP; rank++) {
			for (const cards of perApp) if (cards[rank]) turns.push(cards[rank]);
		}
		return turns;
	});
	// Long enough to read the title and decide, short enough that the home
	// screen doesn't feel frozen.
	const HERO_ROTATION_MS = 20_000;
	// The hero follows a card, not a position: an app arriving (or a dashboard
	// refreshing) reshuffles heroCandidates, and indexing into that would swap
	// the banner out from under whoever is looking at it.
	const heroKey = (card: AppCard) => `${card.appId}:${card.id}`;
	let heroCurrentKey = $state<string | null>(null);
	// Set while the remote's focus is on the hero's button, which a turn
	// would take away from under it.
	let heroFocused = $state(false);
	const heroCard = $derived(
		heroCandidates.find((card) => heroKey(card) === heroCurrentKey) ?? heroCandidates[0]
	);
	// Pin whatever is shown, so a card taking first place doesn't replace it.
	$effect(() => {
		if (heroCard) heroCurrentKey = heroKey(heroCard);
	});
	// Only the count restarts the timer, not every dashboard push.
	const heroCount = $derived(heroCandidates.length);
	$effect(() => {
		if (heroCount < 2 || heroFocused) return;
		const timer = setInterval(() => {
			const at = heroCandidates.findIndex((card) => heroKey(card) === heroCurrentKey);
			heroCurrentKey = heroKey(heroCandidates[(at + 1) % heroCandidates.length]);
		}, HERO_ROTATION_MS);
		return () => clearInterval(timer);
	});

	// Per app: whether it's still loading, and the cards to show in its shelf.
	// The hero's card stays in its row too, since the hero moves on and a row
	// shifting under the remote every few seconds would be worse than one
	// card shown twice. An app that's still loading gets a skeleton; one that
	// settled with zero cards is left out of the shelves below entirely,
	// rather than a row titled "Suggested on {app}" for content that
	// doesn't exist.
	const appRows = $derived(
		apps
			.filter((app) => app.id in cardsByAppId)
			.map((app) => {
				const cards = cardsByAppId[app.id];
				return { ...app, loading: cards === null, shelfCards: cards ?? [] };
			})
	);
	// The rows that render anything, keyed by app below so an app arriving or
	// leaving adds or removes its own row and the others stay as they are
	// (keyed by position, every row after it would be rebuilt, replaying its
	// reveal).
	const shownRows = $derived(appRows.filter((row) => row.loading || row.shelfCards.length > 0));

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
				href={resolve(ROUTES.wifi)}
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
			<LanguagePicker />
		</div>
	</div>
{/snippet}

<!-- Top-level for the same reason as topBar: its own complexity unit. -->
{#snippet hero()}
	{#if heroCard}
		<!-- One cell, so the outgoing banner fades out on top of the
		     incoming one instead of stacking below it. -->
		<div
			class="grid *:col-start-1 *:row-start-1"
			onfocusin={() => (heroFocused = true)}
			onfocusout={() => (heroFocused = false)}
		>
			{#key `${heroCard.appId}:${heroCard.id}`}
				<HeroBanner
					title={heroCard.title}
					description={heroCard.subtitle}
					image={heroCard.image}
					fallbackImage={heroCard.fallbackImage ?? undefined}
					badge={m.featured()}
					source={heroCard.appName}
					href={cardHref(heroCard)}
				/>
			{/key}
		</div>
	{:else if dashboardLoading}
		<HeroBannerSkeleton />
	{:else}
		<HeroBannerEmpty />
	{/if}
{/snippet}

{#if me}
	<div class="relative isolate flex min-h-screen flex-col gap-10 bg-slate-950 pb-16 text-white">
		<div class="pivi-aurora" aria-hidden="true">
			<span></span><span></span><span></span>
		</div>
		<div class="relative">
			{@render hero()}

			{@render topBar(me)}
		</div>

		<div class="flex flex-col gap-10">
			<AppsRow title={m.apps()} items={apps} {pending} />
			{#each shownRows as row (row.id)}
				<div animate:flip={{ duration: 300 }}>
					{#if row.loading}
						<VideoRowSkeleton title={row.name} />
					{:else}
						<VideoRow
							title={m.suggested_on({ app: row.name })}
							items={row.shelfCards.map((c) => ({
								id: c.id,
								title: c.title,
								meta: c.subtitle,
								image: c.image,
								fallbackImage: c.fallbackImage ?? undefined,
								href: cardHref(c)
							}))}
						/>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
