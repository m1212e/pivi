<script lang="ts">
	// Tier 2 renderer: walks an app-supplied UiNode tree (#lib/apps/ui)
	// and draws it with the shell's own components (Button, MediaCard,
	// ContentRow, HeroBanner, ...) — the app only ever sent structure, this
	// component owns every pixel and every event. Anything visual lives in
	// those components, not here, so an app can't look different from the host.
	// One generic renderer serves every app that uses this tier, not just
	// YouTube.
	import TextInput from '#lib/components/TextInput.svelte';
	import { inview } from 'svelte-inview';
	import type { UiNode } from '#lib/apps/ui';
	import { appActionHref } from '#lib/apps/dashboard';
	import { client } from '#lib/api/rumbleClient/client';
	import { graphQLErrorMessage } from '#lib/api/errors';
	import * as m from '#lib/paraglide/messages';
	import Button from '#lib/components/Button.svelte';
	import ContentRow from '#lib/components/ContentRow.svelte';
	import HeroBanner from '#lib/components/HeroBanner.svelte';
	import IconBadge from '#lib/components/IconBadge.svelte';
	import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
	import MediaCard from '#lib/components/MediaCard.svelte';
	import MediaCardSkeleton from '#lib/components/MediaCardSkeleton.svelte';
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

	// A skeleton that stays visible means the last request did nothing (lost
	// event, failed fetch, a page of only duplicates), and inview won't fire
	// again for an element that never left. So ask again until it goes away.
	const skeletonTimers = new WeakMap<Element, ReturnType<typeof setInterval>>();

	function watchSkeleton(el: Element, visible: boolean, eventId: string) {
		clearInterval(skeletonTimers.get(el));
		skeletonTimers.delete(el);
		if (!visible) return;
		onEvent(eventId);
		skeletonTimers.set(
			el,
			setInterval(() => onEvent(eventId), 3000)
		);
	}

	// inview doesn't report a removed element, so stop its timer here.
	function stopSkeletonTimer(el: Element) {
		return {
			destroy() {
				clearInterval(skeletonTimers.get(el));
				skeletonTimers.delete(el);
			}
		};
	}

	// Layout only: how a container arranges its children. Anything with a look
	// of its own is a component (see the node kinds below).
	function containerRowClasses(n: Extract<UiNode, { type: 'container' }>): string {
		const panel = n.panel
			? ' rounded-3xl bg-white/8 px-12 py-10 ring-1 ring-white/12 backdrop-blur-md'
			: '';
		// `self-start` so the stuck column keeps its own height instead of
		// stretching to the full row, which would leave it nothing to stick within.
		const sticky = n.sticky ? ' sticky top-8 self-start' : '';
		const grow =
			panel +
			sticky +
			(n.grow ? ' min-w-0 flex-1' : '') +
			(n.center ? ' items-center text-center' : '');
		if (n.direction !== 'row')
			return `flex flex-col ${n.center ? 'justify-center gap-8 min-h-[70vh]' : 'gap-3'}${grow}`;
		// A real grid, so rows of differently shaped cards (a round channel
		// among videos) stay in the same columns, with the leftover width
		// spread between them instead of piling up on the right.
		if (n.wrap)
			return `grid grid-cols-[repeat(auto-fill,20rem)] items-start justify-between gap-x-4 gap-y-10 px-10${grow}`;
		const justify =
			n.justify === 'between'
				? ' justify-between'
				: n.justify === 'around'
					? ' justify-around'
					: '';
		return `flex flex-row ${n.alignStart ? 'items-start' : 'items-center'} gap-3${justify}${grow}`;
	}
</script>

{#snippet containerChildren(n: Extract<UiNode, { type: 'container' }>)}
	{#each n.children as child, i (i)}
		{#if n.onReachEnd && child.type === 'skeleton' && n.children.findIndex((c) => c.type === 'skeleton') === i}
			<!-- Seeing a skeleton means the user is at the end, so ask for more.
			     Children are keyed by index, so the replacement skeletons after a
			     load are fresh elements and re-observe (also fills a short first page). -->
			<div
				use:stopSkeletonTimer
				use:inview={{ rootMargin: '0px 0px 300px 0px' }}
				oninview_change={(event) => {
					if (n.onReachEnd) watchSkeleton(event.detail.node, event.detail.inView, n.onReachEnd);
				}}
			>
				<Self node={child} {onEvent} {appId} {appHref} />
			</div>
		{:else}
			<Self node={child} {onEvent} {appId} {appHref} />
		{/if}
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
			class="{containerRowClasses(
				n
			)} gap-2! rounded-xl transition hover:bg-white/10 focus:outline-none"
		>
			{@render containerChildren(n)}
		</a>
	{:else if n.onSelect}
		<!-- Same card treatment as the link above, but selecting it sends a UI
		     event to the app instead of navigating. -->
		<button
			type="button"
			onclick={() => n.onSelect && onEvent(n.onSelect)}
			style={widthStyle}
			class="{containerRowClasses(
				n
			)} gap-2! rounded-xl text-left transition hover:bg-white/10 focus:outline-none"
		>
			{@render containerChildren(n)}
		</button>
	{:else}
		<div
			class={containerRowClasses(n)}
			style={widthStyle}
			data-pivi-sticky={n.sticky ? true : undefined}
		>
			{@render containerChildren(n)}
		</div>
	{/if}
{/snippet}

{#snippet containerNode(n: Extract<UiNode, { type: 'container' }>)}
	{#if n.title}
		<!-- A plain heading. Only a `shelf` counts as a row for the remote's
		     vertical centering, so a tall wrapped grid's cards each center on
		     their own, same as the home grid. -->
		<div class="flex flex-col gap-3 {n.grow ? 'min-w-0 flex-1' : ''}">
			<h2 class="text-xl font-semibold text-white/90 {n.wrap ? 'px-10' : ''}">{n.title}</h2>
			{@render containerBody(n)}
		</div>
	{:else}
		{@render containerBody(n)}
	{/if}
{/snippet}

{#snippet textNode(n: Extract<UiNode, { type: 'text' }>)}
	<span
		class={n.variant === 'display'
			? 'text-6xl font-bold tracking-[0.12em] text-white'
			: n.variant === 'headline'
				? 'text-2xl text-white/70'
				: n.variant === 'title'
					? 'text-lg leading-snug font-semibold text-white'
					: n.variant === 'subtitle'
						? 'text-base text-white/60'
						: 'text-sm text-white/70'}
		style={n.lines
			? `display: -webkit-box; -webkit-line-clamp: ${n.lines}; -webkit-box-orient: vertical; overflow: hidden;`
			: undefined}
	>
		{n.value}
	</span>
{/snippet}

{#snippet iconNode(n: Extract<UiNode, { type: 'icon' }>)}
	<IconBadge path={n.path} size={n.size} />
{/snippet}

{#snippet skeletonNode(n: Extract<UiNode, { type: 'skeleton' }>)}
	<div aria-hidden="true">
		<MediaCardSkeleton shape={n.shape} />
	</div>
{/snippet}

{#snippet mediaCardNode(n: Extract<UiNode, { type: 'mediaCard' }>)}
	<MediaCard
		title={n.title}
		meta={n.meta}
		image={n.image}
		shape={n.shape}
		stacked={n.stacked}
		badge={n.badge}
		progress={n.progress}
		href={n.action && appId && appHref ? appActionHref(appId, appHref, n.action) : undefined}
		onSelect={n.onSelect ? () => n.onSelect && onEvent(n.onSelect) : undefined}
	/>
{/snippet}

{#snippet shelfNode(n: Extract<UiNode, { type: 'shelf' }>)}
	<ContentRow title={n.title} inset={false}>
		{#each n.children as child, i (i)}
			<Self node={child} {onEvent} {appId} {appHref} />
		{/each}
	</ContentRow>
{/snippet}

{#snippet heroNode(n: Extract<UiNode, { type: 'hero' }>)}
	{#if appId && appHref}
		<HeroBanner
			title={n.title}
			description={n.description}
			image={n.image}
			badge={n.badge}
			source={n.source}
			href={appActionHref(appId, appHref, n.action)}
		/>
	{/if}
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

{#snippet buttonLabel(n: Extract<UiNode, { type: 'button' }>)}
	{#if n.icon}
		<svg viewBox="0 0 24 24" class="size-6 shrink-0 fill-current" aria-hidden="true">
			<path d={n.icon} />
		</svg>
	{/if}
	{n.label}
{/snippet}

{#snippet buttonLinkNode(n: Extract<UiNode, { type: 'button' }>, href: string)}
	<Button {href} variant={n.variant} size={n.size} selected={n.selected}>
		{@render buttonLabel(n)}
	</Button>
{/snippet}

{#snippet openOnPhoneButtonNode(n: Extract<UiNode, { type: 'button' }>, url: string)}
	<div class="flex flex-col items-start gap-1.5">
		<Button variant={n.variant} size={n.size} onclick={() => openOnPhone(url)}>
			{@render buttonLabel(n)}
		</Button>
		{#if phoneError}
			<p class="text-xs text-red-300">{phoneError}</p>
		{/if}
	</div>
{/snippet}

{#snippet buttonNode(n: Extract<UiNode, { type: 'button' }>)}
	<Button
		variant={n.variant}
		size={n.size}
		selected={n.selected}
		onclick={() => n.onSelect && onEvent(n.onSelect)}
	>
		{@render buttonLabel(n)}
	</Button>
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
	<TextInput
		label={n.label}
		placeholder={n.placeholder}
		secret={n.secret}
		search={n.search}
		suggestions={n.suggestions}
		onInput={n.onInput ? (value) => onEvent(n.onInput!, value) : undefined}
		onSubmit={(value) => onEvent(n.onSubmit, value)}
	/>
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
{:else if node.type === 'icon'}
	{@render iconNode(node)}
{:else if node.type === 'spinner'}
	<LoadingSpinner label={node.label} />
{:else if node.type === 'skeleton'}
	{@render skeletonNode(node)}
{:else if node.type === 'mediaCard'}
	{@render mediaCardNode(node)}
{:else if node.type === 'shelf'}
	{@render shelfNode(node)}
{:else if node.type === 'hero'}
	{@render heroNode(node)}
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
