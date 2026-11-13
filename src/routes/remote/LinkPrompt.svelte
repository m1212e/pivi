<!-- Shown for every link an app sends. Nothing opens until the user has seen
     where it leads and tapped Open, since the app picked the link, not them. -->
<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { ExternalLink } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';

	let { url, onDismiss }: { url: string; onDismiss: () => void } = $props();

	// The parsed host rather than the raw text, so `https://google.com@evil.example`
	// reads as evil.example and lookalike unicode shows as its xn-- form.
	const domain = $derived(new URL(url).hostname);
</script>

<div
	transition:fade={{ duration: 150 }}
	class="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
>
	<div
		transition:scale={{ start: 0.95, duration: 150 }}
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="link-prompt-text"
		aria-describedby="link-prompt-domain"
		class="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-slate-900/90 p-6 text-center shadow-2xl ring-1 shadow-black/40 ring-white/20"
	>
		<span class="rounded-full bg-white/10 p-3 text-white">
			<ExternalLink class="size-6" aria-hidden="true" />
		</span>
		<p id="link-prompt-text" class="text-sm text-white/70">{m.remote_link_pending()}</p>
		<p
			id="link-prompt-domain"
			class="w-full rounded-2xl bg-white/10 px-4 py-3 font-mono text-xl font-semibold break-all text-white"
		>
			{domain}
		</p>
		<div class="flex w-full gap-3 pt-2">
			<button
				type="button"
				onclick={onDismiss}
				class="flex-1 rounded-full bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 focus:outline-none"
			>
				{m.remote_link_cancel()}
			</button>
			<!-- A new tab, not this one: the remote is the TV's only input device,
			     and leaving it would strand the TV until the user found their way
			     back. -->
			<a
				href={url}
				target="_blank"
				rel="external noopener noreferrer"
				onclick={onDismiss}
				class="flex-1 rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white/90 focus:outline-none"
			>
				{m.remote_link_open()}
			</a>
		</div>
	</div>
</div>
