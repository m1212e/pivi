<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { profileGradient } from '#lib/profileColor';
	import { client } from '#lib/api/rumbleClient/client';
	import HeroBanner from '#lib/components/HeroBanner.svelte';
	import PairingQr from '#lib/components/PairingQr.svelte';
	import ContinueWatchingRow from '#lib/components/ContinueWatchingRow.svelte';
	import PosterRow from '#lib/components/PosterRow.svelte';
	import AppsRow from '#lib/components/AppsRow.svelte';
	import { getPairing } from '#lib/state/pairing.svelte';
	import * as m from '#lib/paraglide/messages';

	const me = await client.liveQuery.user({
		__args: { id: page.data.userId },
		id: true,
		username: true
	});
	const label = me?.username;

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

	// Placeholder content until a real media/apps backend exists — shaped the
	// way that data will eventually arrive (a featured item, a "continue"
	// list with progress, a flat app list) so the rows below only need their
	// data source swapped later, not their layout.
	// picsum.photos serves real (if unrelated) stock photos rather than solid
	// color blocks — a seeded URL keeps each card's image stable across
	// reloads without needing actual licensed poster art.
	function placeholderImage(seed: string, width: number, height: number) {
		return `https://picsum.photos/seed/${seed}/${width}/${height}`;
	}

	const featured = {
		title: 'Breaking Bad',
		badge: 'Continue the story',
		description:
			'A high school chemistry teacher diagnosed with terminal cancer turns to manufacturing methamphetamine to secure his family’s future.',
		image: placeholderImage('breaking-bad', 1600, 900)
	};

	const continueWatching = [
		{ id: 'c1', title: 'Ozymandias', subtitle: 'Breaking Bad · S5E14', progress: 0.65 },
		{
			id: 'c2',
			title: 'Chapter Eight: The Battle of Starcourt',
			subtitle: 'Stranger Things · S3E8',
			progress: 0.3
		},
		{ id: 'c3', title: 'Winter Is Coming', subtitle: 'Game of Thrones · S1E1', progress: 0.1 },
		{ id: 'c4', title: 'Fly', subtitle: 'Better Call Saul · S3E10', progress: 0.85 },
		{ id: 'c5', title: 'Pilot', subtitle: 'The Office · S1E1', progress: 0.2 },
		{
			id: 'c6',
			title: 'Chapter One: The Vanishing of Will Byers',
			subtitle: 'Stranger Things · S1E1',
			progress: 0.5
		},
		{
			id: 'c7',
			title: 'The Rains of Castamere',
			subtitle: 'Game of Thrones · S3E9',
			progress: 0.4
		},
		{ id: 'c8', title: 'Tokyo', subtitle: 'Money Heist · S1E1', progress: 0.75 }
	].map((item) => ({ ...item, image: placeholderImage(item.id, 400, 225) }));

	const apps = [
		{ id: 'a1', name: 'Movies' },
		{ id: 'a2', name: 'Shows' },
		{ id: 'a3', name: 'Live TV' },
		{ id: 'a4', name: 'Music' },
		{ id: 'a5', name: 'Settings' },
		{ id: 'a6', name: 'Photos' },
		{ id: 'a7', name: 'Sports' },
		{ id: 'a8', name: 'Kids' },
		{ id: 'a9', name: 'Podcasts' },
		{ id: 'a10', name: 'News' }
	];

	// Poster-shaped rows (2:3, no progress bar) — a different shape than
	// "Continue watching" so the dashboard doesn't read as one repeated row.
	function posterRow(entries: { id: string; title: string; meta: string }[]) {
		return entries.map((item) => ({ ...item, image: placeholderImage(item.id, 400, 600) }));
	}

	const trending = posterRow([
		{ id: 't1', title: 'The Bear', meta: '2024 · Comedy-Drama' },
		{ id: 't2', title: 'Slow Horses', meta: '2024 · Spy Thriller' },
		{ id: 't3', title: 'Shōgun', meta: '2024 · Drama' },
		{ id: 't4', title: 'The Last of Us', meta: '2023 · Drama' },
		{ id: 't5', title: 'Fallout', meta: '2024 · Sci-Fi' },
		{ id: 't6', title: 'True Detective', meta: '2024 · Crime' },
		{ id: 't7', title: 'Severance', meta: '2022 · Sci-Fi' },
		{ id: 't8', title: 'The Diplomat', meta: '2023 · Thriller' }
	]);

	const becauseYouWatched = posterRow([
		{ id: 'b1', title: 'Better Call Saul', meta: '2015 · Crime Drama' },
		{ id: 'b2', title: 'Ozark', meta: '2017 · Crime Drama' },
		{ id: 'b3', title: 'El Camino', meta: '2019 · Movie' },
		{ id: 'b4', title: 'Narcos', meta: '2015 · Crime Drama' },
		{ id: 'b5', title: 'Peaky Blinders', meta: '2013 · Crime Drama' },
		{ id: 'b6', title: 'Fargo', meta: '2014 · Crime Anthology' },
		{ id: 'b7', title: 'Mindhunter', meta: '2017 · Crime Drama' },
		{ id: 'b8', title: 'The Wire', meta: '2002 · Crime Drama' }
	]);

	const newReleases = posterRow([
		{ id: 'n1', title: 'Dune: Part Two', meta: '2024 · Sci-Fi' },
		{ id: 'n2', title: 'Ripley', meta: '2024 · Thriller' },
		{ id: 'n3', title: 'Baby Reindeer', meta: '2024 · Drama' },
		{ id: 'n4', title: '3 Body Problem', meta: '2024 · Sci-Fi' },
		{ id: 'n5', title: 'Griselda', meta: '2024 · Crime Drama' },
		{ id: 'n6', title: 'Masters of the Air', meta: '2024 · War Drama' },
		{ id: 'n7', title: 'Constellation', meta: '2024 · Sci-Fi' },
		{ id: 'n8', title: 'Monsieur Spade', meta: '2024 · Mystery' }
	]);
</script>

<svelte:head><title>Pivi</title></svelte:head>

{#if me}
	<div class="flex min-h-screen flex-col gap-10 bg-slate-950 pb-16 text-white">
		<div class="relative">
			<!-- Floats directly over the hero artwork instead of a separate solid
			     bar, so the image reads as the top of the page. -->
			<div
				data-pivi-top-bar
				class="absolute inset-x-0 top-0 z-10 flex items-start justify-between px-8 pt-6 sm:px-12"
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
					<button
						type="button"
						onclick={signOut}
						class="rounded-full bg-white/12 px-5 py-2 text-sm font-medium text-white/90 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
					>
						{m.switch_profile()}
					</button>

					{#if pairing.remoteUrl}
						<div
							class="rounded-3xl bg-white/12 p-3 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
						>
							<PairingQr url={pairing.remoteUrl} size={220} />
						</div>
					{/if}
				</div>
			</div>

			<HeroBanner
				title={featured.title}
				description={featured.description}
				badge={featured.badge}
				image={featured.image}
			/>
		</div>

		<div class="flex flex-col gap-10">
			<ContinueWatchingRow title="Continue watching" items={continueWatching} />
			<PosterRow title="Trending now" items={trending} />
			<PosterRow title="Because you watched Breaking Bad" items={becauseYouWatched} />
			<PosterRow title="New releases" items={newReleases} />
			<AppsRow title="Apps" items={apps} />
		</div>
	</div>
{/if}
