<script lang="ts">
	// Shown by AppsRow when a tile with a pending update is picked, so the user
	// decides whether to update first instead of finding out on the /apps page.
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { CircleArrowUp } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import Button from './Button.svelte';

	let { name, onUpdate, onOpen }: { name: string; onUpdate: () => void; onOpen: () => void } =
		$props();

	let dialog: HTMLDivElement | undefined = $state();

	// Opening is what the user asked for, so a second press of select does just that.
	onMount(() => {
		const previous = document.activeElement;
		dialog?.querySelector<HTMLElement>('[data-update-prompt-open]')?.focus();
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
	aria-labelledby="app-update-prompt-title"
>
	<div
		class="flex max-w-xl flex-col items-center gap-6 rounded-3xl bg-white/12 p-10 text-center shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
	>
		<CircleArrowUp class="size-12 text-indigo-300" />
		<h2 id="app-update-prompt-title" class="text-3xl font-semibold text-white">
			{m.apps_update_prompt_title({ name })}
		</h2>
		<p class="text-lg text-white/70">{m.apps_update_prompt_description()}</p>
		<div class="flex gap-4">
			<Button data-update-prompt-open size="md" onclick={onOpen}>
				{m.apps_update_prompt_open()}
			</Button>
			<Button variant="solid" size="md" onclick={onUpdate}>
				{m.apps_update_prompt_update()}
			</Button>
		</div>
	</div>
</div>
