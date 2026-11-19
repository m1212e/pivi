<script lang="ts">
	// Asks before the app settings' power off shuts the device down. Most Pis
	// have no power button, so coming back means replugging, which is said here.
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { LoaderCircle, Power } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import Button from './Button.svelte';

	let {
		poweringOff,
		error,
		onConfirm,
		onCancel
	}: {
		poweringOff: boolean;
		error: string | null;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	let dialog: HTMLDivElement | undefined = $state();

	// "Cancel" has the focus: a stray press of select shouldn't turn the device off.
	onMount(() => {
		const previous = document.activeElement;
		dialog?.querySelector<HTMLElement>('[data-power-off-cancel]')?.focus();
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
	aria-labelledby="power-off-dialog-title"
>
	<div
		class="flex max-w-xl flex-col items-center gap-6 rounded-3xl bg-white/12 p-10 text-center shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
	>
		{#if poweringOff}
			<LoaderCircle class="size-12 animate-spin text-rose-300" />
			<h2 id="power-off-dialog-title" class="text-3xl font-semibold text-white">
				{m.power_off_in_progress()}
			</h2>
		{:else}
			<Power class="size-12 text-rose-300" />
			<h2 id="power-off-dialog-title" class="text-3xl font-semibold text-white">
				{m.power_off_title()}
			</h2>
			<p class="text-lg text-white/70">{m.power_off_description()}</p>
			{#if error}
				<p class="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30">
					{error}
				</p>
			{/if}
			<div class="flex gap-4">
				<Button data-power-off-cancel size="md" onclick={onCancel}>
					{m.power_off_cancel()}
				</Button>
				<Button variant="solid" size="md" onclick={onConfirm}>
					{m.power_off_confirm()}
				</Button>
			</div>
		{/if}
	</div>
</div>
