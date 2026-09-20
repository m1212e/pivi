<script lang="ts">
	import { enhance } from '$app/forms';
	import { profileGradient } from '#lib/profileColor';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const label = $derived(data.user.displayUsername ?? data.user.username ?? data.user.name);
</script>

<svelte:head><title>Pivi</title></svelte:head>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-8 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-8 py-16 text-white"
>
	<span
		class="flex size-20 items-center justify-center overflow-hidden rounded-full"
		style="background: {profileGradient(data.user.username ?? data.user.id)}"
	>
		<span class="text-2xl font-semibold text-white/90 uppercase">{label?.slice(0, 1)}</span>
	</span>

	<h1 class="text-3xl font-semibold text-white/95">Welcome, {label}</h1>
	<p class="text-white/50">The rest of Pivi lives here.</p>

	<form method="post" action="?/signOut" use:enhance>
		<button
			class="rounded-full bg-white/10 px-6 py-2 text-sm font-medium text-white/80 ring-1 ring-white/15 transition hover:bg-white/20 focus:outline-none"
		>
			Switch profile
		</button>
	</form>
</div>
