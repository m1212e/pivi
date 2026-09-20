<script lang="ts">
	import { enhance } from '$app/forms';
	import PinPad from '#lib/components/PinPad.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let username = $state('');
	let pin = $state('');

	const canSubmit = $derived(username.trim().length > 0 && pin.length === 4);
</script>

<svelte:head><title>New Profile — Pivi Remote</title></svelte:head>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-8 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-6 py-12 text-white"
>
	<h1 class="text-xl font-semibold text-white/95">Create a new profile</h1>

	<form method="post" use:enhance class="flex flex-col items-center gap-8">
		<input
			name="username"
			bind:value={username}
			placeholder="Username"
			autocomplete="username"
			class="w-64 rounded-full bg-white/10 px-6 py-3 text-center text-lg text-white placeholder-white/40 ring-1 ring-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
		/>

		<input type="hidden" name="pin" value={pin} />
		<PinPad bind:value={pin} error={form?.message} />

		<button
			type="submit"
			disabled={!canSubmit}
			class="rounded-full bg-white px-8 py-3 text-base font-semibold text-indigo-950 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white enabled:hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30"
		>
			Create Profile
		</button>
	</form>
</div>
