<script lang="ts">
	import { fly } from 'svelte/transition';
	import ContentRow from '#lib/components/ContentRow.svelte';
	import AppCard from '#lib/components/AppCard.svelte';

	let {
		title,
		items
	}: {
		title: string;
		items: { id: string; name: string; href: string }[];
	} = $props();
</script>

<ContentRow {title}>
	{#each items as app, i (app.id)}
		<div class="shrink-0" in:fly|global={{ y: 24, duration: 400, delay: i * 70 }}>
			<AppCard id={app.id} name={app.name} href={app.href} />
		</div>
	{/each}
</ContentRow>
