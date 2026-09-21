<script lang="ts">
	import ContentRow from '#lib/components/ContentRow.svelte';
	import ContinueWatchingCard from '#lib/components/ContinueWatchingCard.svelte';

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
		<ContinueWatchingCard
			title={item.title}
			subtitle={item.subtitle}
			image={item.image}
			progress={item.progress}
		/>
	{/each}
</ContentRow>
