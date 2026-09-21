<script lang="ts">
	import ContentRow from '#lib/components/ContentRow.svelte';
	import PosterCard from '#lib/components/PosterCard.svelte';

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
		<PosterCard title={item.title} meta={item.meta} image={item.image} />
	{/each}
</ContentRow>
