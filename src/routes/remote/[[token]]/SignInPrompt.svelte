<!-- Only ever shown when the popup blocker rejected the tab the controller
     tried to open on its own. Sits above the trackpad toggle (z-10) and
     clear of it, since both are pinned to the bottom-right. -->
<script lang="ts">
	import { fly } from 'svelte/transition';
	import { X } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';

	let { url, onDismiss }: { url: string; onDismiss: () => void } = $props();
</script>

<div
	transition:fly={{ y: 24, duration: 200 }}
	class="fixed inset-x-4 bottom-24 z-20 flex items-center gap-3 rounded-3xl bg-white/12 p-3 pl-5 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150"
>
	<p class="min-w-0 flex-1 text-sm text-white/80">{m.app_sign_in_pending()}</p>
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		onclick={onDismiss}
		class="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white/90 focus:outline-none"
	>
		{m.app_sign_in_open()}
	</a>
	<button
		type="button"
		onclick={onDismiss}
		aria-label={m.close()}
		class="shrink-0 rounded-full p-2 text-white/60 transition hover:bg-white/10 focus:outline-none"
	>
		<X class="size-5" aria-hidden="true" />
	</button>
</div>
