<script lang="ts">
	import ContentRow from '#lib/components/ContentRow.svelte';
	import AppCard from '#lib/components/AppCard.svelte';

	let {
		title,
		items
	}: {
		title: string;
		items: { id: string; name: string }[];
	} = $props();
</script>

<ContentRow {title}>
	{#each items as app (app.id)}
		<AppCard id={app.id} name={app.name} />
	{/each}
</ContentRow>
