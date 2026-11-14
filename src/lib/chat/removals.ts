// Applies a chat batch's moderation removals (#sdk/protocol's ChatRemovals).
// Shared by the host's backlog (src/api/apps/runtime.ts) and the TV's chat
// panel, so a removed line disappears from both the same way.
import type { ChatBatch, ChatMessage } from '#sdk/protocol';

/** `messages` without the lines `removed` takes away. */
export function applyChatRemovals(
	messages: ChatMessage[],
	removed: ChatBatch['removed']
): ChatMessage[] {
	if (!removed) return messages;
	if (removed.all) return [];
	const ids = new Set(removed.ids ?? []);
	const authors = new Set(removed.authorIds ?? []);
	if (ids.size === 0 && authors.size === 0) return messages;
	return messages.filter(
		(message) => !ids.has(message.id) && !(message.authorId && authors.has(message.authorId))
	);
}

/** The lines after `batch`: its removals applied, its new lines appended, the latest `keep` kept. */
export function applyChatBatch(
	messages: ChatMessage[],
	batch: ChatBatch,
	keep: number
): ChatMessage[] {
	return [...applyChatRemovals(messages, batch.removed), ...batch.messages].slice(-keep);
}
