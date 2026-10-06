<script lang="ts">
	import { fly } from 'svelte/transition';
	import ContentRow from '#lib/components/ContentRow.svelte';
	import MediaCard from '#lib/components/MediaCard.svelte';

	let {
		title,
		items
	}: {
		title: string;
		items: { id: string; title: string; meta: string; image: string; href: string }[];
	} = $props();
</script>

<ContentRow {title}>
	{#each items as item, i (item.id)}
		<div class="shrink-0" in:fly|global={{ y: 24, duration: 400, delay: i * 70 }}>
			<MediaCard title={item.title} meta={item.meta} image={item.image} href={item.href} />
		</div>
	{/each}
</ContentRow>
