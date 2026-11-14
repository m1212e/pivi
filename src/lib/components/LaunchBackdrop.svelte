<script lang="ts">
	import { launchBackdrop } from '#lib/state/launchBackdrop.svelte';
</script>

<!-- Scaled up a little so the blur's soft edges stay off screen. -->
{#if launchBackdrop.url}
	<img
		src={launchBackdrop.url}
		alt=""
		referrerpolicy="no-referrer"
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 size-full scale-110 object-cover blur-2xl brightness-50 saturate-150"
	/>
{/if}
