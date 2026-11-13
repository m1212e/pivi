<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import Button from '#lib/components/Button.svelte';

	let { message, onBack }: { message: string; onBack: () => void } = $props();
</script>

<div class="flex size-full flex-col items-center justify-center gap-3 text-white">
	<p class="text-lg font-medium">{m.playback_failed()}</p>
	<p class="max-w-sm text-center text-sm text-white/60">{message}</p>
	<Button variant="solid" size="md" onclick={onBack} class="mt-2">
		{m.back()}
	</Button>
</div>
