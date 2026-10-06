<script lang="ts">
	import ContentRow from '#lib/components/ContentRow.svelte';
	import MediaCard from '#lib/components/MediaCard.svelte';

	let {
		title,
		items
	}: {
		title: string;
		items: { id: string; title: string; meta: string; image: string }[];
	} = $props();
</script>

<ContentRow {title}>
	{#each items as item (item.id)}
		<MediaCard shape="poster" title={item.title} meta={item.meta} image={item.image} />
	{/each}
</ContentRow>
