<script lang="ts">
	import { fly } from 'svelte/transition';
	import ContentRow from '#lib/components/ContentRow.svelte';
	import MediaCard from '#lib/components/MediaCard.svelte';

	// A dashboard shelf of video cards for one app's suggestions. Kept apart
	// from AppsRow because these are media thumbnails that link into an app,
	// while that one holds app tiles plus the add-app entry.
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
