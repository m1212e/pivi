<script lang="ts">
	import { goto } from '$app/navigation';
	import { profileGradient } from '#lib/profileColor';
	import { client } from '#lib/api/rumbleClient/client';

	const me = await client.query.me({ id: true, username: true, displayUsername: true });
	const label = me?.displayUsername ?? me?.username;

	async function signOut() {
		await client.mutate.signOut();
		await goto('/');
	}
</script>

<svelte:head><title>Pivi</title></svelte:head>

{#if me}
	<div
		class="flex min-h-screen flex-col items-center justify-center gap-8 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-8 py-16 text-white"
	>
		<span
			class="flex size-20 items-center justify-center overflow-hidden rounded-full"
			style="background: {profileGradient(me.username ?? me.id)}"
		>
			<span class="text-2xl font-semibold text-white/90 uppercase">{label?.slice(0, 1)}</span>
		</span>

		<h1 class="text-3xl font-semibold text-white/95">Welcome, {label}</h1>
		<p class="text-white/50">The rest of Pivi lives here.</p>

		<button
			onclick={signOut}
			class="rounded-full bg-white/10 px-6 py-2 text-sm font-medium text-white/80 ring-1 ring-white/15 transition hover:bg-white/20 focus:outline-none"
		>
			Switch profile
		</button>
	</div>
{/if}
