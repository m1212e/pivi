<script lang="ts">
	import ContentRow from '#lib/components/ContentRow.svelte';
	import VideoCardSkeleton from '#lib/components/VideoCardSkeleton.svelte';

	let { title, count = 6 }: { title: string; count?: number } = $props();
</script>

<ContentRow {title}>
	{#each Array(count) as _, i (i)}
		<VideoCardSkeleton />
	{/each}
</ContentRow>
