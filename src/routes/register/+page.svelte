<script lang="ts">
	import { enhance } from '$app/forms';
	import PinPad from '#lib/components/PinPad.svelte';
	import { usernameError } from '#lib/username';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let step = $state<'name' | 'pin'>('name');
	let username = $state('');
	let usernameTouched = $state(false);
	let pin = $state('');
	let usernameInput: HTMLInputElement | undefined = $state();
	let formEl: HTMLFormElement;

	const trimmedUsername = $derived(username.trim());
	const nameError = $derived(usernameError(trimmedUsername));

	function goToPin() {
		usernameTouched = true;
		if (nameError) return;
		step = 'pin';
	}

	function goToName() {
		step = 'name';
		pin = '';
	}

	// Wait for the effect queue (not an oncomplete callback, which fires
	// before Svelte has flushed `pin` into the hidden input's DOM value) so
	// requestSubmit() reads the fully-updated 4-digit value.
	$effect(() => {
		if (step === 'pin' && pin.length === 4) formEl.requestSubmit();
	});

	$effect(() => {
		if (step === 'name') usernameInput?.focus();
	});
</script>

<svelte:head><title>New Profile — Pivi</title></svelte:head>

<div
	class="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 px-8 py-16 text-white"
>
	<a
		href="/"
		onclick={(event) => {
			if (step === 'pin') {
				event.preventDefault();
				goToName();
			}
		}}
		class="absolute top-8 left-8 text-sm font-medium text-white/60 transition hover:text-white focus:outline-none"
	>
		&larr; Back
	</a>

	<form
		bind:this={formEl}
		method="post"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure') pin = '';
				await update();
			};
		}}
		class="flex flex-col items-center gap-8"
	>
		<input type="hidden" name="username" value={username} />
		<input type="hidden" name="pin" value={pin} />

		{#if step === 'name'}
			<h1 class="text-2xl font-semibold text-white/95">Choose a username</h1>
			<input
				bind:this={usernameInput}
				bind:value={username}
				onblur={() => (usernameTouched = true)}
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						goToPin();
					}
				}}
				placeholder="Username"
				autocomplete="username"
				class="w-64 rounded-full bg-white/10 px-6 py-3 text-center text-lg text-white placeholder-white/40 ring-1 ring-white/15 focus:outline-none"
			/>
			{#if usernameTouched && trimmedUsername.length > 0 && nameError}
				<p class="-mt-4 text-sm font-medium text-rose-400">{nameError}</p>
			{/if}
			<button
				type="button"
				onclick={goToPin}
				disabled={!trimmedUsername || !!nameError}
				class="rounded-full bg-white px-8 py-3 text-base font-semibold text-indigo-950 transition focus:outline-none enabled:hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30"
			>
				Next
			</button>
		{:else}
			<h1 class="text-2xl font-semibold text-white/95">Set a 4-digit PIN</h1>
			<PinPad bind:value={pin} error={form?.message} />
		{/if}
	</form>
</div>
