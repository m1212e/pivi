<script lang="ts">
	// Draws an app's IconRef (#sdk/icons): the host's own Lucide icon when it
	// names one, otherwise the app's 24x24 path, filled like before.
	import { hostIconComponent } from '#lib/apps/hostIcons';
	import type { IconRef } from '#sdk/icons';

	let { icon, class: className = 'size-6' }: { icon: IconRef; class?: string } = $props();

	const Host = $derived(hostIconComponent(icon));
</script>

{#if Host}
	<Host class="shrink-0 {className}" aria-hidden="true" />
{:else}
	<svg viewBox="0 0 24 24" class="shrink-0 fill-current {className}" aria-hidden="true">
		<path d={icon} />
	</svg>
{/if}
