<script lang="ts">
	import { scale } from 'svelte/transition';
	import { Grid3x3, Hand, Keyboard, Play, Users } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import type { RemoteTab } from '#lib/pairing/remoteTabs';

	const TARGET_ICON = {
		trackpad: Hand,
		pin: Grid3x3,
		keyboard: Keyboard,
		profiles: Users,
		player: Play
	} as const;
	const TARGET_LABEL = {
		trackpad: m.switch_to_trackpad,
		pin: m.switch_to_pin_pad,
		keyboard: m.switch_to_keyboard,
		profiles: m.switch_to_profiles,
		player: m.switch_to_player
	} as const;

	let {
		target,
		keyboardInset,
		onToggle
	}: { target: RemoteTab; keyboardInset: number; onToggle: () => void } = $props();

	const Icon = $derived(TARGET_ICON[target]);
</script>

<button
	type="button"
	onclick={onToggle}
	aria-label={TARGET_LABEL[target]()}
	style="bottom: calc(1.5rem + {keyboardInset}px)"
	transition:scale={{ duration: 200, start: 0.7 }}
	class="fixed right-6 z-10 rounded-full bg-white/12 p-4 text-white/80 shadow-lg ring-1 shadow-black/20 ring-white/25 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
>
	<Icon class="size-6" aria-hidden="true" />
</button>
