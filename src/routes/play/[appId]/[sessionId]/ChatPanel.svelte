<script lang="ts">
	import * as m from '#lib/paraglide/messages';
	import { client } from '#lib/api/rumbleClient/client';
	import { stopSubscription } from '#lib/api/subscription';
	import { applyChatBatch } from '#lib/chat/removals';
	import type { ChatBatch, ChatMessage } from '#sdk/protocol';

	let { appId, sessionId }: { appId: string; sessionId: string } = $props();

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

<aside
	class="flex h-full w-[22rem] shrink-0 flex-col border-l border-white/10 bg-slate-950/95 text-sm text-white"
	aria-label={m.chat()}
>
	<header class="px-4 py-3 text-xs font-semibold tracking-wide text-white/60 uppercase">
		{m.chat()}
	</header>
	<!-- Bottom anchored: new lines push old ones off the top, no scrolling to
	     manage with a remote. -->
	<ol class="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden px-4 pb-4">
		{#each messages as message (message.id)}
			<li class="leading-snug break-words">
				<span class="font-semibold" style:color={colorFor(message)}>{message.author}</span><span
					class="text-white/50">:</span
				>
				{#each message.parts as part, i (i)}
					{#if part.type === 'emote'}
						<img
							src={part.url}
							alt={part.name}
							title={part.name}
							class="inline-block h-6 w-auto align-middle"
						/>
					{:else}
						<span>{part.text}</span>
					{/if}
				{/each}
			</li>
		{:else}
			<li class="text-white/40">{m.chat_empty()}</li>
		{/each}
	</ol>
</aside>
