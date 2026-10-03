<script lang="ts">
	import ContentRow from '#lib/components/ContentRow.svelte';
	import * as m from '#lib/paraglide/messages';
	import PlaceholderCard from '#lib/components/PlaceholderCard.svelte';

	// Rendered instead of a real content row for an app that hasn't
	// contributed any cards -- e.g. YouTube installed but nobody's signed in
	// yet. Deliberately titled with the app's plain name rather than
	// "Suggested on {appName}": that phrasing only makes sense once there's
	// actually something suggested.
	let { appName, appHref }: { appName: string; appHref: string } = $props();

	const GRADIENTS = [
		'linear-gradient(135deg, #6366f1, #ec4899)',
		'linear-gradient(135deg, #06b6d4, #6366f1)',
		'linear-gradient(135deg, #f59e0b, #ef4444)',
		'linear-gradient(135deg, #10b981, #06b6d4)'
	];

	const cards = $derived([
		{ title: m.placeholder_login_to({ app: appName }), gradient: GRADIENTS[0] },
		{ title: m.placeholder_content_here(), gradient: GRADIENTS[1] },
		{ title: m.placeholder_content_here(), gradient: GRADIENTS[2] },
		{ title: m.placeholder_content_here(), gradient: GRADIENTS[3] }
	]);
</script>

<ContentRow title={appName}>
	{#each cards as card, i (i)}
		<PlaceholderCard title={card.title} gradient={card.gradient} href={appHref} />
	{/each}
</ContentRow>
