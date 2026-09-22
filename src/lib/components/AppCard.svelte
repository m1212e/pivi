<script lang="ts">
	import { profileGradient } from '#lib/profileColor';

	let {
		id,
		name,
		href
	}: {
		id: string;
		name: string;
		href: string;
	} = $props();

	const gradient = $derived(profileGradient(id));
</script>

<a {href} class="group flex w-28 shrink-0 flex-col items-center gap-2 focus:outline-none sm:w-32">
	<span
		data-focus-ring-target
		class="pivi-card flex size-20 items-center justify-center rounded-2xl text-lg font-semibold text-white/90 uppercase transition group-hover:scale-105 sm:size-24"
		style="background: {gradient}; --pivi-glow: {gradient}"
	>
		{name.slice(0, 1)}
	</span>
	<span class="truncate text-xs font-medium text-white/70">{name}</span>
</a>
