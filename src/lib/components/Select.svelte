<script lang="ts" generics="T">
	// A single collapsed button that expands on click/select and collapses
	// again the moment one is chosen -- the discrete-choice counterpart to
	// Slider.svelte's continuous one, for exactly the same reason Slider
	// needed a press-first gesture: a long list of options rendered flat
	// (every option always on screen, one button each) reads as an unusable
	// wall of controls the moment there are more than a handful, and is
	// genuinely painful to swipe through on a remote. A short list expands
	// into a small dropdown panel; a long one (past FULL_SCREEN_THRESHOLD --
	// a subtitle track list, easily) takes over the whole screen instead,
	// since even a scrollable dropdown panel is too small a window onto
	// dozens of options to browse comfortably.
	//
	// Unlike Slider, this needs no swipe-interception/armed dance of its own
	// -- every option is a real, separately-focusable <button>, so
	// RemoteBridge.svelte's existing geometry-based spatial nav already
	// swipes between them (and into/out of the list) for free the moment
	// they're actually rendered. The only real work here is *when* they're
	// rendered at all: collapsed by default, expanded on a press, and
	// re-collapsed on a choice or on losing focus, so the normal case is one
	// small button, not the whole option list.
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { ChevronDown, ChevronUp, X } from '@lucide/svelte';

	// Past this many options, the small dropdown panel itself becomes the
	// problem (a subtitle track list can run into the dozens) -- swapping to
	// a full-screen picker past this point trades the panel's own compact
	// footprint for genuinely comfortable browsing/swiping room instead of a
	// tiny scrollable sliver of the screen.
	const FULL_SCREEN_THRESHOLD = 7;

	let {
		value = $bindable() as T,
		options,
		label,
		disabled = false,
		option,
		onChange
	}: {
		value: T;
		options: readonly T[];
		label: string;
		disabled?: boolean;
		// Renders one option's content -- called once for the collapsed
		// trigger (with the currently selected value) and once per row while
		// expanded, so a caller only ever describes "how to show one option",
		// never the trigger/list chrome around it. The second argument is
		// whether *this particular rendering* sits on the solid white
		// "selected row" background rather than the trigger/other rows' dark
		// translucent one -- not simply "is this the selected value", since
		// the trigger always shows the selected value but never gets that
		// white background itself; a caller picking icon colors for contrast
		// needs to know which background it's actually on.
		option: Snippet<[T, boolean]>;
		// For a choice that needs to do more than just update `value` (the
		// quality picker's own selectQuality, say, which re-attaches
		// playback) -- fired alongside the bindable `value` update, not
		// instead of it, so a caller that only cares about the new value can
		// still just bind it and ignore this.
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

	// Keeps whichever option currently has focus on screen -- both list
	// containers scroll independently of the document (their own
	// `overflow-y-auto`, one of them inside a `position: fixed` overlay to
	// boot), so RemoteBridge.svelte's own scroll-the-focused-thing-into-view
	// logic (scoped to `[data-pivi-row]`/`[data-pivi-hscroll]`, neither of
	// which this is) never reaches them -- a remote swipe or a real arrow key
	// moving focus through a long option list would otherwise walk focus
	// straight off the visible, scrolled area. `center` rather than
	// `nearest`: landing the focused option in the middle of the screen
	// (rather than just barely scrolled into view at an edge) gives a remote
	// swipe the most room in either direction before it needs to scroll again.
	function scrollOptionIntoView(event: FocusEvent) {
		(event.currentTarget as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	// Collapses on Escape, or the moment focus lands anywhere outside the
	// control -- both scoped to document-level listeners installed only
	// while actually expanded (see the effect below) rather than handlers on
	// the wrapper `<div>` itself, which would need to be given some
	// interactive ARIA role it doesn't really have just to satisfy the
	// linter (RemoteBridge.svelte's own focus tracking uses this identical
	// document-level-listener-plus-containment-check shape, for the same
	// reason). Focus rather than a plain click-outside check, since a remote
	// swipe carrying focus elsewhere should collapse this exactly like a
	// mouse/touch interaction would.
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

	// Moves focus itself rather than leaving it to whatever happens to still
	// hold it: into the list (landing on the current selection so a remote
	// swipe continues from there, not the top) the moment it opens, and back
	// onto the trigger once it closes -- otherwise closing the list out from
	// under a focused row would drop focus to <body> with no way back short
	// of a real Tab. Skipped on the very first render (`opened` stays false
	// until this has actually been expanded once) so mounting this component
	// collapsed never steals focus from wherever the page's own initial
	// focus target is.
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

	// Reveals each chip (full-screen mode only) as it actually scrolls into
	// view, rather than on a flat delay from when the panel opened -- a list
	// long enough to need scrolling (the whole reason this mode exists)
	// finishes animating everything within about a second regardless of
	// where it sits in the list, so anything below the fold would already
	// have reached its final resting state long before a viewer scrolls down
	// far enough to actually see it, and never visibly animate at all (this
	// is exactly what a flat `i`-based delay used to do here). Only the
	// batch that's already visible the instant the panel opens gets the
	// index-based stagger, matching the home dashboard's own shelves;
	// anything revealed later, by actually scrolling to it, appears
	// immediately instead of waiting on a delay that has nothing to do with
	// how fast the viewer is scrolling.
	const REVEAL_MS = 400;
	// Anything revealed within this window of opening counts as part of the
	// initial screenful, and gets the index-based stagger; anything revealed
	// after it (by the viewer actually scrolling there) reveals immediately
	// instead. A time window rather than "only entries from the very first
	// observer callback": with enough elements to observe at once (a
	// hundred-plus-language subtitle list, easily), the browser can split that
	// very first check across more than one callback invocation, which used to
	// hand out delay 0 to anything past whichever batch size the first
	// invocation happened to contain -- visually, the stagger just stopped
	// partway through the first screenful instead of covering all of it.
	const INITIAL_WINDOW_MS = 150;

	// Duration explicitly zeroed here, not just left unset -- these buttons
	// already carry Tailwind's own `transition` class (for their hover state),
	// which comes with its own non-zero default duration covering
	// opacity/transform among other properties. Leaving duration unset would
	// still inherit that default, animating this initial hide as a visible
	// fade-from-default flicker the instant the panel opens (every option
	// briefly fading out before any of them fade back in). An explicit inline
	// `0ms` here beats the class's own value the same way the reveal below
	// beats it with its own explicit duration.
	function hideForReveal(buttons: HTMLElement[]) {
		for (const button of buttons) {
			button.style.transitionDuration = '0ms';
			button.style.opacity = '0';
			button.style.transform = 'translateY(24px)';
		}
	}

	// `index` is the option's own fixed position in the list, not a counter of
	// how many have been revealed so far -- a counter's value depends on which
	// callback invocation (and in what order within it) delivered this entry,
	// which isn't guaranteed to line up with visual order once the initial
	// check is itself split across invocations the way described above. The
	// list's own DOM order is exactly the on-screen order already, so indexing
	// into it directly gives every option a stable delay regardless of how the
	// browser happened to batch the notifications.
	function revealOption(el: HTMLElement, index: number, openedAt: number) {
		const initial = performance.now() - openedAt < INITIAL_WINDOW_MS;
		const delay = initial ? Math.min(index * 20, 300) : 0;
		// Duration only, not the `transition` shorthand -- these buttons
		// already carry Tailwind's own `transition` class (for their hover
		// state), whose property list already covers opacity/transform; a
		// shorthand override here would silently replace that list with just
		// these two properties for good, killing the hover transition on
		// color/background from then on.
		el.style.transitionDuration = `${REVEAL_MS}ms`;
		el.style.transitionDelay = `${delay}ms`;
		el.style.opacity = '1';
		el.style.transform = 'none';
		// Clears the duration/delay overrides once this option's own reveal has
		// actually finished, so its Tailwind `transition` class goes back to
		// its normal (much shorter) hover timing afterward instead of staying
		// stuck at this reveal's.
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

	// Traps focus inside this control while it's expanded -- without this,
	// RemoteBridge.svelte's geometry-based spatial nav (or a real Tab) can
	// walk focus onto some other on-screen control that's still technically
	// present and focusable in the DOM (just visually sitting behind this
	// control's own overlay/panel), which the focus-loss handling above then
	// reads as "focus left the control" and closes it right back out --
	// especially easy to hit swiping past the last option in a long
	// full-screen list. `inert` on every sibling along the path from this
	// control up to <body> (not just this element's own direct siblings)
	// removes everything else on the page from both focus and pointer
	// interaction while expanded, which is the standard way to trap focus
	// for a control that isn't rendered as its own top-level portal.
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
					aria-label="Close"
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
			class="absolute right-0 bottom-full z-20 mb-2 flex max-h-[60vh] w-32 flex-col gap-1 overflow-y-auto rounded-2xl bg-white/12 p-1.5 shadow-lg ring-1 shadow-black/20 ring-white/20 backdrop-blur-2xl backdrop-saturate-150"
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
