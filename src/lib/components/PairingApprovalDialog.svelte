<script lang="ts">
	// Shown by RemoteBridge when a new phone wants to pair while another one is
	// connected. The connected phone's trackpad is the only way to answer, which
	// is the point: whoever already controls the TV decides.
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { ShieldQuestionMark } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import Button from './Button.svelte';

	let { name, onDecide }: { name: string; onDecide: (approved: boolean) => void } = $props();

	let dialog: HTMLDivElement | undefined = $state();

	// Deny starts focused, so a stray select press never lets a phone in.
	onMount(() => {
		const previous = document.activeElement;
		dialog?.querySelector<HTMLElement>('[data-pairing-deny]')?.focus();
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
	aria-labelledby="pairing-approval-title"
>
	<div
		class="flex max-w-xl flex-col items-center gap-6 rounded-3xl bg-white/12 p-10 text-center shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
	>
		<ShieldQuestionMark class="size-12 text-white/80" />
		<h2 id="pairing-approval-title" class="text-3xl font-semibold text-white">
			{m.pairing_approval_title({ name })}
		</h2>
		<p class="text-lg text-white/70">{m.pairing_approval_description()}</p>
		<div class="flex gap-4">
			<Button data-pairing-deny size="md" onclick={() => onDecide(false)}>
				{m.pairing_approval_deny()}
			</Button>
			<Button variant="solid" size="md" onclick={() => onDecide(true)}>
				{m.pairing_approval_allow()}
			</Button>
		</div>
	</div>
</div>
