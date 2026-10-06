<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import TextField from '#lib/components/TextField.svelte';
	import PinPad from '#lib/components/PinPad.svelte';
	import { usernameError } from '#lib/username';
	import { client } from '#lib/api/rumbleClient/client';
	import { resetClientState } from '#lib/api/client';
	import { goto } from '$app/navigation';
	import { graphQLErrorMessage } from '#lib/api/errors';
	import * as m from '#lib/paraglide/messages';

	let step = $state<'name' | 'pin'>('name');
	let username = $state('');
	let usernameTouched = $state(false);
	let pin = $state('');
	let message = $state<string>();
	let usernameField: TextField | undefined = $state();

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

	async function submit() {
		try {
			await client.mutate.register({ __args: { username: trimmedUsername, pin } });
			// The previous profile's cached query results must not leak into the
			// new one; urql's cache can't be cleared outright (see client.ts).
			resetClientState();
			await goto('/home');
		} catch (err) {
			message = graphQLErrorMessage(err, m.could_not_create_profile());
			pin = '';
		}
	}

	// Wait for the effect queue so the fully-updated 4-digit value is read.
	$effect(() => {
		if (step === 'pin' && pin.length === 4) submit();
	});

	$effect(() => {
		if (step === 'name') usernameField?.focus();
	});
</script>

<svelte:head><title>{m.new_profile_title()}</title></svelte:head>

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
		&larr; {m.back()}
	</a>

	<div class="flex flex-col items-center gap-8">
		{#if step === 'name'}
			<h1 class="text-2xl font-semibold text-white/95">{m.choose_username()}</h1>
			<TextField
				bind:this={usernameField}
				bind:value={username}
				label={m.choose_username()}
				placeholder={m.username_placeholder()}
				autocomplete="username"
				center
				class="w-64 rounded-full bg-white/12 px-6 py-3 text-lg shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
				onblur={() => (usernameTouched = true)}
				onEnter={(event) => {
					event.preventDefault();
					goToPin();
				}}
			/>
			{#if usernameTouched && trimmedUsername.length > 0 && nameError}
				<p class="-mt-4 text-sm font-medium text-rose-400">{nameError}</p>
			{/if}
			<Button
				variant="solid"
				size="md"
				onclick={goToPin}
				disabled={!trimmedUsername || !!nameError}
			>
				{m.next()}
			</Button>
		{:else}
			<h1 class="text-2xl font-semibold text-white/95">{m.set_pin()}</h1>
			<PinPad bind:value={pin} error={message} showKeypad={false} />
		{/if}
	</div>
</div>
