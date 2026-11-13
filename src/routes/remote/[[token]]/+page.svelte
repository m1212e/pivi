<script lang="ts">
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import PinPad from '#lib/components/PinPad.svelte';
	import * as m from '#lib/paraglide/messages';
	import { createKeyboardInset } from '#lib/pairing/keyboardInset.svelte';
	import { createRemoteController } from '#lib/pairing/remoteController.svelte';
	import { createRemoteTabState } from '#lib/pairing/remoteTabState.svelte';
	import { browserStorage } from '#lib/storage';
	import AppShortcuts from './AppShortcuts.svelte';
	import KeyboardTab from './KeyboardTab.svelte';
	import PlayerTab from './PlayerTab.svelte';
	import ProfilesTab from './ProfilesTab.svelte';
	import RemoteHeader from './RemoteHeader.svelte';
	import SignInPrompt from './SignInPrompt.svelte';
	import StatusScreen from './StatusScreen.svelte';
	import TrackpadTab from './TrackpadTab.svelte';
	import TrackpadToggle from './TrackpadToggle.svelte';

	const remote = createRemoteController(page.params.token ?? null);
	const tabs = createRemoteTabState({
		storage: browserStorage(browser),
		getTv: () => remote.tv
	});
	const keyboardInset = createKeyboardInset();

	$effect(() => remote.setPhoneKeyboard(tabs.phoneKeyboard));

	let pin = $state('');
</script>

<svelte:head>
	<title>{m.remote_title()}</title>
	<link rel="manifest" href="/remote/manifest.webmanifest" />
	<meta name="theme-color" content="#020617" />
	<link rel="apple-touch-icon" href="/remote/apple-touch-icon.png" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content={m.remote_title()} />
</svelte:head>

<div
	class="flex h-dvh flex-col bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 text-white"
>
	{#if remote.phase === 'ready'}
		<RemoteHeader
			canGoBack={remote.tv.canGoBack}
			canGoHome={remote.tv.canGoHome}
			connected={remote.connected}
			onBack={remote.back}
			onHome={remote.home}
		/>

		<main
			class="flex flex-1 flex-col items-center justify-center px-6 transition-transform duration-300 ease-out"
			style="transform: translateY(-{tabs.displayed === 'keyboard'
				? keyboardInset.value / 2
				: 0}px)"
		>
			{#if tabs.displayed === 'trackpad'}
				<AppShortcuts apps={remote.tv.apps} onSelect={remote.selectApp} />
				<TrackpadTab actions={remote.trackpad} />
			{:else if tabs.displayed === 'pin'}
				<PinPad bind:value={pin} onkey={remote.pinKey} oncomplete={() => (pin = '')} />
			{:else if tabs.displayed === 'profiles'}
				<ProfilesTab profiles={remote.tv.profiles} onSelect={remote.selectProfile} />
			{:else if tabs.displayed === 'player'}
				<PlayerTab {remote} />
			{:else}
				<KeyboardTab
					bind:text={remote.text}
					suggestions={remote.tv.suggestions}
					onInput={remote.sendText}
					onSubmit={remote.submitText}
					onExit={remote.exitText}
					onPickSuggestion={remote.pickSuggestion}
				/>
			{/if}
		</main>

		{#if tabs.required !== 'trackpad'}
			<TrackpadToggle
				target={tabs.toggleTarget}
				keyboardInset={keyboardInset.value}
				onToggle={tabs.toggleTrackpad}
			/>
		{/if}

		{#if remote.pendingSignInUrl}
			<SignInPrompt url={remote.pendingSignInUrl} onDismiss={remote.dismissSignIn} />
		{/if}
	{:else}
		<StatusScreen phase={remote.phase} errorMessage={remote.errorMessage} />
	{/if}
</div>
