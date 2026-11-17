<script lang="ts">
	// Shown on the home screen after a login when pivi downloaded a new release
	// in the background (src/api/systemUpdate.ts). Installing only takes a
	// reboot by then; "later" leaves it to the nightly install.
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { CircleArrowUp, LoaderCircle } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import Button from './Button.svelte';

	let {
		version,
		installing,
		error,
		onInstall,
		onLater
	}: {
		version: string;
		installing: boolean;
		error: string | null;
		onInstall: () => void;
		onLater: () => void;
	} = $props();

	let dialog: HTMLDivElement | undefined = $state();

	// "Later" has the focus: a stray press of select shouldn't restart the TV.
	onMount(() => {
		const previous = document.activeElement;
		dialog?.querySelector<HTMLElement>('[data-system-update-later]')?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	});
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
	transition:fade={{ duration: 150 }}
	bind:this={dialog}
	data-pivi-modal
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="system-update-prompt-title"
>
	<div
		class="flex max-w-xl flex-col items-center gap-6 rounded-3xl bg-white/12 p-10 text-center shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
	>
		{#if installing}
			<LoaderCircle class="size-12 animate-spin text-indigo-300" />
			<h2 id="system-update-prompt-title" class="text-3xl font-semibold text-white">
				{m.system_update_installing()}
			</h2>
		{:else}
			<CircleArrowUp class="size-12 text-indigo-300" />
			<h2 id="system-update-prompt-title" class="text-3xl font-semibold text-white">
				{m.system_update_prompt_title({ version })}
			</h2>
			<p class="text-lg text-white/70">{m.system_update_prompt_description()}</p>
			{#if error}
				<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">
					{error}
				</p>
			{/if}
			<div class="flex gap-4">
				<Button data-system-update-later size="md" onclick={onLater}>
					{m.system_update_later()}
				</Button>
				<Button variant="solid" size="md" onclick={onInstall}>
					{m.system_update_install()}
				</Button>
			</div>
		{/if}
	</div>
</div>
