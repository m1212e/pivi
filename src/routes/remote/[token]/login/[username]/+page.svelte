<script lang="ts">
	import { enhance } from '$app/forms';
	import { profileGradient } from '#lib/profileColor';
	import PinPad from '#lib/components/PinPad.svelte';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let pin = $state('');
	let formEl: HTMLFormElement;

	const label = $derived(data.profile.displayUsername ?? data.profile.username ?? 'Profile');

	function submit() {
		formEl.requestSubmit();
	}
</script>

<svelte:head><title>{label} — Pivi Remote</title></svelte:head>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-8 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-6 py-12 text-white"
>
	<span
		class="flex size-20 items-center justify-center overflow-hidden rounded-full"
		style="background: {profileGradient(data.profile.username ?? data.profile.id)}"
	>
		{#if data.profile.image}
			<img src={data.profile.image} alt="" class="size-full object-cover" />
		{:else}
			<span class="text-2xl font-semibold text-white/90 uppercase">{label.slice(0, 1)}</span>
		{/if}
	</span>

	<h1 class="text-xl font-semibold text-white/95">Enter PIN for {label}</h1>

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
		<PinPad bind:value={pin} error={form?.message} oncomplete={submit} />
	</form>
</div>
