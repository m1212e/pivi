<script lang="ts">
	import { MessageSquare } from '@lucide/svelte';
	import * as m from '#lib/paraglide/messages';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import { applyChatBatch } from '#lib/chat/removals';
	import type { ChatMode } from '#lib/playback/chatMode';
	import type { ChatBatch, ChatMessage } from '@pivi/sdk/protocol';

	let {
		appId,
		sessionId,
		mode,
		controlsVisible
	}: {
		appId: string;
		sessionId: string;
		/** See #lib/playback/chatMode. */
		mode: Exclude<ChatMode, 'off'>;
		/** The bottom controls are showing, an overlay moves up out of their way. */
		controlsVisible: boolean;
	} = $props();

	// More than fit on screen, so a burst doesn't leave it half empty.
	const KEEP = 80;

	let messages = $state<ChatMessage[]>([]);

	// Mounted only while chat is shown, so the subscription (and with it the
	// app's chat connection, see handlers/playback.ts) lives exactly that long.
	$effect(() => {
		const subscription = client.subscribe
			.appChat({ __args: { appId, sessionId }, json: true })
			.subscribe((batch) => {
				if (!batch?.json) return;
				// Removals by moderators first, then the new lines, see applyChatBatch.
				messages = applyChatBatch(messages, JSON.parse(batch.json) as ChatBatch, KEEP);
			});
		return () => stopSubscription(subscription);
	});

	// Over the video, chat leaves the top bar and the bottom controls free.
	const overlayBox = $derived(
		`absolute top-24 right-6 w-[28rem] transition-[bottom] duration-300 sm:right-10 ${controlsVisible ? 'bottom-56' : 'bottom-6'}`
	);
	const containerClass = $derived(
		{
			// A column of its own beside the video, which shrinks to make room.
			outside: 'h-full w-[28rem] shrink-0 border-l border-white/10 bg-white/5',
			// A card of the same glass as the player's buttons.
			floating: `${overlayBox} rounded-3xl bg-white/10 shadow-2xl ring-1 shadow-black/30 ring-white/20 backdrop-blur-2xl backdrop-saturate-150`,
			// Only the lines, readable over any picture by their shadow.
			embedded: overlayBox
		}[mode]
	);

	const embedded = $derived(mode === 'embedded');

	// Twitch's own palette for people who never picked a color, chosen by name
	// so a person keeps theirs.
	const DEFAULT_COLORS = ['#ff4a80', '#4b9eff', '#00c48c', '#ff8a3d', '#b07bff', '#ffd23f'];
	function colorFor(message: ChatMessage): string {
		if (message.color) return message.color;
		let hash = 0;
		for (const char of message.author) hash = (hash * 31 + char.charCodeAt(0)) | 0;
		return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
	}
</script>

{#snippet line(message: ChatMessage)}
	<li
		class="leading-snug break-words {embedded
			? 'outlined font-medium'
			: 'drop-shadow-[0_1px_1px_rgb(0_0_0/0.6)]'}"
	>
		<!-- Without a box, dark name colors (navy, maroon) vanish on dark
		     pictures, so embedded lifts them toward white. -->
		<span
			class="font-semibold"
			style:color={embedded
				? `color-mix(in oklab, ${colorFor(message)}, white 35%)`
				: colorFor(message)}>{message.author}</span
		><span class={embedded ? 'text-white/80' : 'text-white/50'}>:</span>
		{#each message.parts as part, i (i)}
			{#if part.type === 'emote'}
				<img
					src={part.url}
					alt={part.name}
					title={part.name}
					class="inline-block h-8 w-auto align-middle"
				/>
			{:else}
				<span class={embedded ? 'text-white' : 'text-white/95'}>{part.text}</span>
			{/if}
		{/each}
	</li>
{/snippet}

<!-- Not interactive, the mode picker lives with the other controls, so chat
     never takes remote focus. Older lines fade out at the top. -->
<aside
	class="pointer-events-none flex flex-col overflow-hidden text-lg text-white {containerClass}"
	aria-label={m.chat()}
>
	{#if !embedded}
		<header
			class="flex items-center gap-2 border-b border-white/10 px-5 py-3 text-sm font-semibold tracking-wide text-white/70 uppercase"
		>
			<MessageSquare class="size-4" />
			{m.chat()}
		</header>
	{/if}
	<!-- Bottom anchored: new lines push old ones off the top, no scrolling to
	     manage with a remote. -->
	<ol
		class="chat-lines flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden px-5 pt-2 pb-4"
	>
		{#each messages as message, i (i)}
			{@render line(message)}
		{:else}
			<li class="text-white/50">{m.chat_empty()}</li>
		{/each}
	</ol>
</aside>

<style>
	/* Lines leaving at the top fade instead of being cut off at the edge. */
	.chat-lines {
		mask-image: linear-gradient(to bottom, transparent, black 4rem);
	}

	/* Embedded has no box behind it: a thin dark outline keeps every letter
	   readable over bright and busy pictures, a soft shadow lifts it off. */
	.outlined {
		text-shadow:
			-1px -1px 0 rgb(0 0 0 / 0.85),
			1px -1px 0 rgb(0 0 0 / 0.85),
			-1px 1px 0 rgb(0 0 0 / 0.85),
			1px 1px 0 rgb(0 0 0 / 0.85),
			0 2px 6px rgb(0 0 0 / 0.9);
	}
</style>
