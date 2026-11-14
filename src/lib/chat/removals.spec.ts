import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@pivi/sdk/protocol';
import { applyChatBatch, applyChatRemovals } from './removals';

const line = (id: string, authorId?: string): ChatMessage => ({
	id,
	author: authorId ?? 'anon',
	authorId,
	parts: [{ type: 'text', text: id }]
});

describe('chat removals', () => {
	const lines = [line('a', 'u1'), line('b', 'u2'), line('c', 'u1'), line('d')];

	it('drops single messages by id and everything by a removed author', () => {
		expect(applyChatRemovals(lines, { ids: ['b'] }).map((m) => m.id)).toEqual(['a', 'c', 'd']);
		expect(applyChatRemovals(lines, { authorIds: ['u1'] }).map((m) => m.id)).toEqual(['b', 'd']);
	});

	it('clears everything, and leaves lines alone without removals', () => {
		expect(applyChatRemovals(lines, { all: true })).toEqual([]);
		expect(applyChatRemovals(lines, undefined)).toBe(lines);
	});

	it('removes before appending the batch and keeps only the latest lines', () => {
		const next = applyChatBatch(
			lines,
			{ messages: [line('e', 'u1')], removed: { authorIds: ['u1'] } },
			3
		);
		expect(next.map((m) => m.id)).toEqual(['b', 'd', 'e']);
	});
});
