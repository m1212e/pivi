<script lang="ts" generics="T">
	import * as m from '#lib/paraglide/messages';
	// The one dropdown, used by LanguagePicker, the player's track pickers and the
	// remote's player tab. Options render only while expanded so a remote swipe
	// doesn't walk through a wall of buttons. Long lists go full screen.
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { ChevronDown, ChevronUp, X } from '@lucide/svelte';

	// A subtitle list can run into the dozens, too many for a small panel.
	const FULL_SCREEN_THRESHOLD = 7;

	let {
		value = $bindable() as T,
		options,
		label,
		disabled = false,
		placement = 'above',
		option,
		onChange
	}: {
		value: T;
		options: readonly T[];
		label: string;
		disabled?: boolean;
		// Defaults to above for the player's bottom-corner controls.
		placement?: 'above' | 'below';
		// Draws one option, for the trigger and for each row. The flag is true on
		// the white selected row, so callers can pick contrasting icon colors.
		option: Snippet<[T, boolean]>;
		// For choices with side effects, like the quality picker re-attaching
		// playback. Fires alongside the `value` update.
		onChange?: (next: T) => void;
	} = $props();

	let expanded = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let triggerEl: HTMLButtonElement | undefined = $state();
	const fullScreen = $derived(options.length > FULL_SCREEN_THRESHOLD);

	function toggle() {
		if (disabled) return;
		expanded = !expanded;
	}

	function choose(next: T) {
		value = next;
		expanded = false;
		onChange?.(next);
	}

	// The lists scroll on their own, outside RemoteBridge's row scrolling, so
	// remote focus would walk off screen. Centered to leave swipe room both ways.
	function scrollOptionIntoView(event: FocusEvent) {
		(event.currentTarget as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	// Focus rather than click outside, so a remote swipe away collapses it too.
	// Document listeners avoid giving the wrapper div a fake interactive role.
	function onDocumentFocusIn() {
		if (root && document.activeElement && root.contains(document.activeElement)) return;
		expanded = false;
	}

	function onDocumentKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			expanded = false;
		}
	}

	$effect(() => {
		if (!expanded) return;
		document.addEventListener('focusin', onDocumentFocusIn);
		document.addEventListener('keydown', onDocumentKeydown);
		return () => {
			document.removeEventListener('focusin', onDocumentFocusIn);
			document.removeEventListener('keydown', onDocumentKeydown);
		};
	});

	// Closing under a focused row would drop focus to <body>, so it goes back
	// to the trigger. Opening lands on the selection so swipes continue from it.
	// `opened` keeps the first render from stealing the page's initial focus.
	let opened = false;
	$effect(() => {
		if (expanded) {
			opened = true;
			const selected = root?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
			(selected ?? root?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
		} else if (opened) {
			triggerEl?.focus();
		}
	});

	// Full-screen options animate in as they scroll into view. A flat delay
	// from opening would finish offscreen before the viewer ever got there.
	const REVEAL_MS = 400;
	// Reveals within this window get the stagger. A time window because the
	// browser may split the first intersection check across several callbacks.
	const INITIAL_WINDOW_MS = 150;

	// Explicit 0ms, as Tailwind's `transition` class would otherwise animate
	// the hide as a visible flicker.
	function hideForReveal(buttons: HTMLElement[]) {
		for (const button of buttons) {
			button.style.transitionDuration = '0ms';
			button.style.opacity = '0';
			button.style.transform = 'translateY(24px)';
		}
	}

	// `index` is the DOM position, which stays in visual order however the
	// observer batches its callbacks.
	function revealOption(el: HTMLElement, index: number, openedAt: number) {
		const initial = performance.now() - openedAt < INITIAL_WINDOW_MS;
		const delay = initial ? Math.min(index * 20, 300) : 0;
		// Duration only, the `transition` shorthand would drop Tailwind's hover
		// transitions for good.
		el.style.transitionDuration = `${REVEAL_MS}ms`;
		el.style.transitionDelay = `${delay}ms`;
		el.style.opacity = '1';
		el.style.transform = 'none';
		// Restores the short hover timing once the reveal is done.
		setTimeout(() => {
			el.style.transitionDuration = '';
			el.style.transitionDelay = '';
		}, delay + REVEAL_MS);
	}

	function startRevealOnScroll(container: HTMLElement) {
		const buttons = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
		hideForReveal(buttons);
		const openedAt = performance.now();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const el = entry.target as HTMLElement;
					revealOption(el, buttons.indexOf(el), openedAt);
					observer.unobserve(el);
				}
			},
			{ threshold: 0.1 }
		);
		for (const button of buttons) observer.observe(button);
		return () => observer.disconnect();
	}

	$effect(() => {
		if (!expanded || !fullScreen) return;
		const container = root;
		if (!container) return;
		return startRevealOnScroll(container);
	});

	// Traps focus while expanded. Otherwise spatial nav could reach controls
	// behind the overlay, which the focus-out handling reads as leaving and
	// closes the list. `inert` up the whole ancestor path, as there is no portal.
	function setChildrenInert(parent: Element, except: Element, isInert: boolean) {
		for (const sibling of parent.children) {
			if (sibling !== except) sibling.toggleAttribute('inert', isInert);
		}
	}

	function setSiblingsInert(target: Element, isInert: boolean) {
		let node: Element = target;
		let parent = node.parentElement;
		while (parent) {
			setChildrenInert(parent, node, isInert);
			node = parent;
			parent = node.parentElement;
		}
	}

	$effect(() => {
		const container = root;
		if (!expanded || !container) return;
		setSiblingsInert(container, true);
		return () => setSiblingsInert(container, false);
	});
</script>

<div bind:this={root} class="relative">
	<button
		bind:this={triggerEl}
		type="button"
		onclick={toggle}
		{disabled}
		aria-haspopup="listbox"
		aria-expanded={expanded}
		aria-label={label}
		class="flex w-32 items-center justify-between gap-2 rounded-full bg-white/12 px-3 py-2 text-xs font-medium text-white/70 shadow-lg ring-1 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
	>
		{@render option(value, false)}
		{#if expanded}
			<ChevronDown class="size-3.5 shrink-0 text-white/50" />
		{:else}
			<ChevronUp class="size-3.5 shrink-0 text-white/50" />
		{/if}
	</button>

	{#if expanded && fullScreen}
		<!-- A dozens-long option list (a subtitle track picker, easily) turns
		     the small dropdown below into an unusably tiny scrollable sliver --
		     past FULL_SCREEN_THRESHOLD, take over the whole screen instead so
		     there's actually room to browse/swipe through it. The close button
		     leads (not trails) the wrapped list so it reads as "leave this
		     mode" rather than one option among others, and is the one thing
		     here that doesn't call `choose` -- it collapses without touching
		     `value` at all, same as Escape/focus-loss already do. -->
		<div
			role="listbox"
			aria-label={label}
			transition:fade={{ duration: 200 }}
			class="fixed inset-0 z-30 overflow-y-auto bg-slate-950/50 p-8 backdrop-blur-2xl"
		>
			<div class="mx-auto flex max-w-4xl flex-wrap content-start justify-center gap-3">
				<button
					type="button"
					onclick={() => (expanded = false)}
					aria-label={m.close()}
					in:fly|global={{ y: 24, duration: 400 }}
					class="flex size-12 items-center justify-center rounded-full bg-white/12 text-white shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/20 focus:outline-none"
				>
					<X class="size-5" />
				</button>
				<!-- Reveal-on-scroll (see the effect above) owns each option's
				     opacity/transform/transition-delay directly via plain style
				     properties -- no `in:` transition here, which would fight
				     over the same properties on mount instead of leaving them
				     alone until this option actually scrolls into view. -->
				{#each options as candidate (candidate)}
					{@const selected = candidate === value}
					<button
						type="button"
						role="option"
						aria-selected={selected}
						onclick={() => choose(candidate)}
						onfocus={scrollOptionIntoView}
						class="flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition focus:outline-none {selected
							? 'bg-white text-slate-950 shadow-lg'
							: 'bg-white/12 text-white/80 ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150 hover:bg-white/20'}"
					>
						{@render option(candidate, selected)}
					</button>
				{/each}
			</div>
		</div>
	{:else if expanded}
		<!-- Anchored to open upward from the trigger with a capped height,
		     not just stacked below/above it uncapped -- these live in the
		     bottom-right corner of the player, so an uncapped list (the very
		     thing the full-screen mode above exists for) would just overflow
		     off the top of the screen for a long enough option list. -->
		<div
			role="listbox"
			aria-label={label}
			class="absolute right-0 z-20 flex {placement === 'above'
				? 'bottom-full mb-2'
				: 'top-full mt-2'} max-h-[60vh] w-32 flex-col gap-1 overflow-y-auto rounded-2xl bg-white/12 p-1.5 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150"
		>
			{#each options as candidate (candidate)}
				{@const selected = candidate === value}
				<button
					type="button"
					role="option"
					aria-selected={selected}
					onclick={() => choose(candidate)}
					onfocus={scrollOptionIntoView}
					class="flex items-center justify-between gap-2 rounded-full px-3 py-2 text-xs font-medium transition focus:outline-none {selected
						? 'bg-white text-slate-950 shadow-lg'
						: 'text-white/70 hover:bg-white/20'}"
				>
					{@render option(candidate, selected)}
				</button>
			{/each}
		</div>
	{/if}
</div>
