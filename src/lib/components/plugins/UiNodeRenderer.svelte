<script lang="ts">
	// Tier 2 renderer: walks a plugin-supplied UiNode tree (#lib/plugins/ui)
	// and draws it with plain shell markup — the plugin only ever sent
	// structure, this component owns every pixel and every event. One
	// generic renderer serves every plugin that uses this tier, not just
	// YouTube.
	import type { UiNode } from '#lib/plugins/ui';
	import Self from './UiNodeRenderer.svelte';

	let {
		node,
		onEvent
	}: {
		node: UiNode;
		onEvent: (eventId: string, value?: string | boolean) => void;
	} = $props();
</script>

{#if node.type === 'container'}
	<div class="flex gap-3 {node.direction === 'row' ? 'flex-row items-center' : 'flex-col'}">
		{#each node.children as child, i (i)}
			<Self node={child} {onEvent} />
		{/each}
	</div>
{:else if node.type === 'text'}
	<span
		class={node.variant === 'title'
			? 'font-medium text-white/90'
			: node.variant === 'subtitle'
				? 'text-sm text-white/50'
				: 'text-sm text-white/70'}
	>
		{node.value}
	</span>
{:else if node.type === 'image'}
	<img
		src={node.src}
		alt=""
		class="rounded-lg object-cover {node.aspect === 'poster'
			? 'aspect-2/3 w-24'
			: node.aspect === 'square'
				? 'aspect-square w-16'
				: 'aspect-video w-32'}"
	/>
{:else if node.type === 'button'}
	<button
		type="button"
		onclick={() => onEvent(node.onSelect)}
		class="rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/20 focus:outline-none"
	>
		{node.label}
	</button>
{:else if node.type === 'toggle'}
	<label class="flex items-center gap-2 text-sm text-white/80">
		<input
			type="checkbox"
			checked={node.value}
			onchange={(e) => onEvent(node.onChange, e.currentTarget.checked)}
		/>
		{node.label}
	</label>
{:else if node.type === 'textInput'}
	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			const input = e.currentTarget.elements.namedItem('value') as HTMLInputElement;
			onEvent(node.onSubmit, input.value);
		}}
	>
		<input
			name="value"
			type={node.secret ? 'password' : 'text'}
			placeholder={node.placeholder ?? node.label}
			aria-label={node.label}
			class="rounded-full bg-white/12 px-4 py-2 text-sm text-white placeholder-white/40 focus:outline-none"
		/>
		<button
			type="submit"
			class="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950"
		>
			Go
		</button>
	</form>
{:else if node.type === 'list'}
	<div class="flex flex-col gap-3">
		{#each node.items as item, i (i)}
			<Self node={item} {onEvent} />
		{/each}
	</div>
{/if}
