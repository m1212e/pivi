<script lang="ts">
	// The phone's plugin management sheet, over the remote like WifiSetup — the
	// screen that exists because of the device's own state, not because the TV
	// asked for something. The content is shared with the TV's own page
	// (PluginManagerPanel.svelte); this only adds the sheet around it.
	import { Puzzle, X } from '@lucide/svelte';
	import type { z } from 'zod';
	import type { pluginsStateParamsSchema } from '#lib/pairing/remoteProtocol';
	import * as m from '#lib/paraglide/messages';
	import PluginManagerPanel, { type PluginActions } from './PluginManagerPanel.svelte';

	let {
		plugins,
		actions,
		onClose
	}: {
		plugins: z.infer<typeof pluginsStateParamsSchema>;
		actions: PluginActions;
		onClose: () => void;
	} = $props();
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-xl">
	<header class="flex items-center justify-between px-4 pt-4 pb-2">
		<h2 class="flex items-center gap-2 text-lg font-semibold text-white/90">
			<Puzzle class="size-5 text-white/60" />
			{m.plugins_title()}
		</h2>
		<button
			type="button"
			onclick={onClose}
			aria-label={m.plugins_cancel()}
			class="rounded-full bg-white/12 p-2 text-white/70 transition hover:bg-white/20 focus:outline-none"
		>
			<X class="size-5" />
		</button>
	</header>

	<div class="flex-1 overflow-y-auto px-4 pb-8">
		<PluginManagerPanel {plugins} {actions} />
	</div>
</div>
