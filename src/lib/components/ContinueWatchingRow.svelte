<script lang="ts">
	import ContentRow from '#lib/components/ContentRow.svelte';
	import MediaCard from '#lib/components/MediaCard.svelte';

	let {
		title,
		items
	}: {
		title: string;
		items: { id: string; title: string; subtitle: string; image: string; progress: number }[];
	} = $props();
</script>

<ContentRow {title}>
	{#each items as item (item.id)}
		<MediaCard
			title={item.title}
			meta={item.subtitle}
			image={item.image}
			progress={item.progress}
		/>
	{/each}
</ContentRow>
