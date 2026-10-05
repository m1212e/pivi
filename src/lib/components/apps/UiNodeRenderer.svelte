<script lang="ts">
	// Tier 2 renderer: walks an app-supplied UiNode tree (#lib/apps/ui)
	// and draws it with plain shell markup — the app only ever sent
	// structure, this component owns every pixel and every event. One
	// generic renderer serves every app that uses this tier, not just
	// YouTube.
	import type { UiNode } from '#lib/apps/ui';
	import { appActionHref } from '#lib/apps/dashboard';
	import { client } from '#lib/api/rumbleClient/client';
	import { graphQLErrorMessage } from '#lib/api/errors';
	import * as m from '#lib/paraglide/messages';
	import Self from './UiNodeRenderer.svelte';

	let {
		node,
		onEvent,
		appId,
		appHref
	}: {
		node: UiNode;
		onEvent: (eventId: string, value?: string | boolean) => void;
		// Only needed by a button carrying an `action` (see #lib/apps/ui's
		// UiNode) — every other node type ignores these.
		appId?: string;
		appHref?: string;
	} = $props();

	// Set when a button's `openOnPhone` action is refused (no phone
	// connected) -- the mutation otherwise just starts work and returns, so
	// this is the only feedback the button has to give. Scoped to this node's
	// own component instance (recursion creates one per node), so one
	// button's error never bleeds onto another's.
	let phoneError = $state<string | null>(null);

	function openOnPhone(url: string) {
		phoneError = null;
		client.mutate.openUrlOnPhone({ __args: { url } }).catch((err: unknown) => {
			phoneError = graphQLErrorMessage(err, m.app_open_on_phone_refused());
		});
	}

	// `scroll` and `wrap` are mutually meaningful opposites of a plain row
	// (overflow horizontally vs. wrap onto new lines) -- `scroll` wins if an
	// app somehow sets both, since a wrapped grid has no scroll container for
	// `pivi-row-fade`'s edge mask to apply to.
	function containerRowClasses(n: Extract<UiNode, { type: 'container' }>): string {
		if (n.direction !== 'row') return 'flex flex-col gap-3';
		if (n.scroll)
			return 'flex flex-row gap-3 items-stretch overflow-x-auto scrollbar-none pivi-row-fade';
		if (n.wrap) return 'flex flex-row flex-wrap items-start gap-3';
		return 'flex flex-row items-center gap-3';
	}
</script>

{#snippet containerChildren(n: Extract<UiNode, { type: 'container' }>)}
	{#each n.children as child, i (i)}
		<Self node={child} {onEvent} {appId} {appHref} />
	{/each}
{/snippet}

{#snippet containerBody(n: Extract<UiNode, { type: 'container' }>)}
	{@const widthStyle = n.width ? `width: ${n.width}` : undefined}
	{#if n.action && appId && appHref}
		<!-- A card (thumbnail + title + channel, say) acting as one link --
		     same appActionHref every button/dashboard card already resolves
		     through, just wrapping the whole container instead of a pill. -->
		<!-- No padding here -- `width` (above) sets this element's own
		     border-box width, and a child image/text is sized to match that
		     same figure exactly (see imageNode); padding would shrink this
		     element's content box below that, pushing the child past its own
		     edge instead of stretching to fill it. The hover highlight and the
		     global focus outline's own `outline-offset` already give enough
		     visual breathing room without it. -->
		<a
			href={appActionHref(appId, appHref, n.action)}
			style={widthStyle}
			class="{containerRowClasses(n)} rounded-xl transition hover:bg-white/10 focus:outline-none"
		>
			{@render containerChildren(n)}
		</a>
	{:else}
		<!-- `data-pivi-hscroll` only on the actual scrolling element -- same
		     attribute ContentRow's own shelf carries, so RemoteBridge's spatial
		     nav snaps a selected card all the way to this row's edge instead of
		     just far enough to bring it into view. -->
		<div
			class={containerRowClasses(n)}
			style={widthStyle}
			data-pivi-hscroll={n.scroll ? true : undefined}
		>
			{@render containerChildren(n)}
		</div>
	{/if}
{/snippet}

{#snippet containerNode(n: Extract<UiNode, { type: 'container' }>)}
	{#if n.title}
		<!-- `data-pivi-row` + `.pivi-row-title` mirror ContentRow's own shelf
		     heading exactly, including the "grow while a card inside has
		     focus" treatment (see layout.css) -- an app gets that for free by
		     setting `title`, rather than a bespoke heading of its own. -->
		<div data-pivi-row class="flex flex-col gap-3">
			<h2 class="pivi-row-title text-xl font-semibold text-white/90">{n.title}</h2>
			{@render containerBody(n)}
		</div>
	{:else}
		{@render containerBody(n)}
	{/if}
{/snippet}

{#snippet textNode(n: Extract<UiNode, { type: 'text' }>)}
	<span
		class={n.variant === 'title'
			? 'font-medium text-white/90'
			: n.variant === 'subtitle'
				? 'text-sm text-white/50'
				: 'text-sm text-white/70'}
		style={n.lines
			? `display: -webkit-box; -webkit-line-clamp: ${n.lines}; -webkit-box-orient: vertical; overflow: hidden;`
			: undefined}
	>
		{n.value}
	</span>
{/snippet}

{#snippet imageNode(n: Extract<UiNode, { type: 'image' }>)}
	<span
		class="relative block {n.width ? '' : 'w-fit'}"
		style={n.width ? `width: ${n.width}` : undefined}
	>
		<img
			src={n.src}
			alt=""
			class="w-full rounded-lg object-cover {n.aspect === 'poster'
				? 'aspect-2/3'
				: n.aspect === 'square'
					? 'aspect-square'
					: 'aspect-video'} {n.width
				? ''
				: n.aspect === 'poster'
					? 'w-24'
					: n.aspect === 'square'
						? 'w-16'
						: 'w-32'}"
		/>
		{#if n.badge}
			<span
				class="absolute right-1 bottom-1 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white"
			>
				{n.badge}
			</span>
		{/if}
	</span>
{/snippet}

{#snippet buttonLinkNode(n: Extract<UiNode, { type: 'button' }>, href: string)}
	<a
		{href}
		class="rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/20 focus:outline-none"
	>
		{n.label}
	</a>
{/snippet}

{#snippet openOnPhoneButtonNode(n: Extract<UiNode, { type: 'button' }>, url: string)}
	<div class="flex flex-col items-start gap-1.5">
		<button
			type="button"
			onclick={() => openOnPhone(url)}
			class="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-white/90 focus:outline-none"
		>
			{n.label}
		</button>
		{#if phoneError}
			<p class="text-xs text-red-300">{phoneError}</p>
		{/if}
	</div>
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
			<Self node={item} {onEvent} {appId} {appHref} />
		{/each}
	</div>
{/snippet}

{#if node.type === 'container'}
	{@render containerNode(node)}
{:else if node.type === 'text'}
	{@render textNode(node)}
{:else if node.type === 'image'}
	{@render imageNode(node)}
{:else if node.type === 'button' && node.action?.type === 'openOnPhone'}
	{@render openOnPhoneButtonNode(node, node.action.url)}
{:else if node.type === 'button' && node.action && appId && appHref}
	{@render buttonLinkNode(node, appActionHref(appId, appHref, node.action))}
{:else if node.type === 'button'}
	{@render buttonNode(node)}
{:else if node.type === 'toggle'}
	{@render toggleNode(node)}
{:else if node.type === 'textInput'}
	{@render textInputNode(node)}
{:else if node.type === 'list'}
	{@render listNode(node)}
{/if}
