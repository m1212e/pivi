<script lang="ts">
	import ContentRow from '#lib/components/ContentRow.svelte';
	import VideoCardSkeleton from '#lib/components/VideoCardSkeleton.svelte';

	let { title, count = 6 }: { title: string; count?: number } = $props();
</script>

<ContentRow {title}>
	<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -- only the index is needed, but Svelte's each requires naming the item too -->
	{#each Array(count) as _, i (i)}
		<VideoCardSkeleton />
	{/each}
</ContentRow>
