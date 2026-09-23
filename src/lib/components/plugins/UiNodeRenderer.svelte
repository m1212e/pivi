<script lang="ts">
	// Tier 2 renderer: walks a plugin-supplied UiNode tree (#lib/plugins/ui)
	// and draws it with plain shell markup — the plugin only ever sent
	// structure, this component owns every pixel and every event. One
	// generic renderer serves every plugin that uses this tier, not just
	// YouTube.
	import type { UiNode } from '#lib/plugins/ui';
	import { pluginActionHref } from '#lib/plugins/dashboard';
	import Self from './UiNodeRenderer.svelte';

	let {
		node,
		onEvent,
		pluginId,
		appHref
	}: {
		node: UiNode;
		onEvent: (eventId: string, value?: string | boolean) => void;
		// Only needed by a button carrying an `action` (see #lib/plugins/ui's
		// UiNode) — every other node type ignores these.
		pluginId?: string;
		appHref?: string;
	} = $props();
</script>

{#snippet containerNode(n: Extract<UiNode, { type: 'container' }>)}
	<div class="flex gap-3 {n.direction === 'row' ? 'flex-row items-center' : 'flex-col'}">
		{#each n.children as child, i (i)}
			<Self node={child} {onEvent} {pluginId} {appHref} />
		{/each}
	</div>
{/snippet}

{#snippet textNode(n: Extract<UiNode, { type: 'text' }>)}
	<span
		class={n.variant === 'title'
			? 'font-medium text-white/90'
			: n.variant === 'subtitle'
				? 'text-sm text-white/50'
				: 'text-sm text-white/70'}
	>
		{n.value}
	</span>
{/snippet}

{#snippet imageNode(n: Extract<UiNode, { type: 'image' }>)}
	<img
		src={n.src}
		alt=""
		class="rounded-lg object-cover {n.aspect === 'poster'
			? 'aspect-2/3 w-24'
			: n.aspect === 'square'
				? 'aspect-square w-16'
				: 'aspect-video w-32'}"
	/>
{/snippet}

{#snippet buttonLinkNode(n: Extract<UiNode, { type: 'button' }>, href: string)}
	<a
		{href}
		class="rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/20 focus:outline-none"
	>
		{n.label}
	</a>
{/snippet}

{#snippet buttonNode(n: Extract<UiNode, { type: 'button' }>)}
	<button
		type="button"
		onclick={() => n.onSelect && onEvent(n.onSelect)}
		class="rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/20 focus:outline-none"
	>
		{n.label}
	</button>
{/snippet}

{#snippet toggleNode(n: Extract<UiNode, { type: 'toggle' }>)}
	<label class="flex items-center gap-2 text-sm text-white/80">
		<input
			type="checkbox"
			checked={n.value}
			onchange={(e) => onEvent(n.onChange, e.currentTarget.checked)}
		/>
		{n.label}
	</label>
{/snippet}

{#snippet textInputNode(n: Extract<UiNode, { type: 'textInput' }>)}
	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			const input = e.currentTarget.elements.namedItem('value') as HTMLInputElement;
			onEvent(n.onSubmit, input.value);
		}}
	>
		<input
			name="value"
			type={n.secret ? 'password' : 'text'}
			placeholder={n.placeholder ?? n.label}
			aria-label={n.label}
			class="rounded-full bg-white/12 px-4 py-2 text-sm text-white placeholder-white/40 focus:outline-none"
		/>
		<button
			type="submit"
			class="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950"
		>
			Go
		</button>
	</form>
{/snippet}

{#snippet listNode(n: Extract<UiNode, { type: 'list' }>)}
	<div class="flex flex-col gap-3">
		{#each n.items as item, i (i)}
			<Self node={item} {onEvent} {pluginId} {appHref} />
		{/each}
	</div>
{/snippet}

{#if node.type === 'container'}
	{@render containerNode(node)}
{:else if node.type === 'text'}
	{@render textNode(node)}
{:else if node.type === 'image'}
	{@render imageNode(node)}
{:else if node.type === 'button' && node.action && pluginId && appHref}
	{@render buttonLinkNode(node, pluginActionHref(pluginId, appHref, node.action))}
{:else if node.type === 'button'}
	{@render buttonNode(node)}
{:else if node.type === 'toggle'}
	{@render toggleNode(node)}
{:else if node.type === 'textInput'}
	{@render textInputNode(node)}
{:else if node.type === 'list'}
	{@render listNode(node)}
{/if}
