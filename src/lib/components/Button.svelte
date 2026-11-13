<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	// The one pill button. `solid` is the primary action, `soft` a quieter
	// translucent one, `nav` a full-width list entry (sidebars). Renders a link
	// when given an `href`, a button otherwise, so callers never restyle either.
	// Floating icon-only controls (player overlay, remote) are a different
	// shape and stay their own markup.
	type Props = Omit<HTMLButtonAttributes, 'class' | 'children'> & {
		variant?: 'solid' | 'soft' | 'nav';
		size?: 'sm' | 'md' | 'lg';
		href?: string;
		// A `nav` entry for the current page.
		selected?: boolean;
		// Extra layout classes only (width, margin), never colors or sizes.
		class?: string;
		children: Snippet;
	};

	let {
		variant = 'soft',
		size = 'sm',
		href,
		selected = false,
		class: extra = '',
		children,
		...rest
	}: Props = $props();

	const SIZES = {
		sm: 'px-4 py-2 text-sm',
		md: 'px-6 py-2.5 text-sm sm:text-base',
		lg: 'px-8 py-4 text-2xl'
	};

	const classes = $derived(
		[
			variant === 'nav'
				? `relative isolate flex w-full items-center gap-4 rounded-xl px-3 py-2.5 text-left text-base ${
						selected ? 'font-semibold text-white' : 'text-white/80 hover:bg-white/10'
					}`
				: `inline-flex items-center justify-center gap-2 rounded-full font-medium transition ${SIZES[size]} ${
						variant === 'solid'
							? 'bg-white font-semibold text-slate-950 hover:bg-white/90'
							: 'bg-white/12 text-white/90 hover:bg-white/20'
					}`,
			'focus:outline-none disabled:cursor-not-allowed disabled:opacity-30',
			extra
		].join(' ')
	);
</script>

<!-- The highlight is its own element so a view transition can slide it from
     the old entry to the new one (see the app page and layout.css). Only one
     entry is ever selected, so the name stays unique. -->
{#snippet content()}
	{#if variant === 'nav' && selected}
		<span
			class="absolute inset-0 -z-10 rounded-xl bg-white/15"
			style:view-transition-name="nav-indicator"
			aria-hidden="true"
		></span>
	{/if}
	{@render children()}
{/snippet}

{#if href}
	<a {href} class={classes} aria-current={selected ? 'page' : undefined}>
		{@render content()}
	</a>
{:else}
	<button type="button" {...rest} class={classes} aria-current={selected ? 'page' : undefined}>
		{@render content()}
	</button>
{/if}
