<script lang="ts">
	import { enhance } from '$app/forms';
	import { profileGradient } from '#lib/profileColor';
	import PinPad from '#lib/components/PinPad.svelte';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let pin = $state('');
	let formEl: HTMLFormElement;

	const label = $derived(data.profile.displayUsername ?? data.profile.username ?? 'Profile');

	// Wait for the effect queue (not the oncomplete callback, which fires
	// before Svelte has flushed `pin` into the hidden input's DOM value) so
	// requestSubmit() reads the fully-updated 4-digit value.
	$effect(() => {
		if (pin.length === 4) formEl.requestSubmit();
	});
</script>

<svelte:head><title>{label} — Pivi</title></svelte:head>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-8 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-8 py-16 text-white"
>
	<a
		href="/"
		class="absolute top-8 left-8 text-sm font-medium text-white/60 transition hover:text-white focus:outline-none"
	>
		&larr; Back
	</a>

	<span
		class="flex size-24 items-center justify-center overflow-hidden rounded-full"
		style="background: {profileGradient(data.profile.username ?? data.profile.id)}"
	>
		{#if data.profile.image}
			<img src={data.profile.image} alt="" class="size-full object-cover" />
		{:else}
			<span class="text-3xl font-semibold text-white/90 uppercase">{label.slice(0, 1)}</span>
		{/if}
	</span>

	<h1 class="text-2xl font-semibold text-white/95">Enter PIN for {label}</h1>

	<form
		bind:this={formEl}
		method="post"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure') pin = '';
				await update();
			};
		}}
	>
		<input type="hidden" name="pin" value={pin} />
		<PinPad bind:value={pin} error={form?.message} />
	</form>
</div>
