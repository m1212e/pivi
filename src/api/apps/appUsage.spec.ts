import { describe, expect, it } from 'vitest';
import { sortByLastUsed } from './appUsage';

describe('sortByLastUsed', () => {
	it('puts the most recently used first and keeps the rest in their order', () => {
		const apps = ['a', 'b', 'c', 'd', 'e'];
		const lastUsed = new Map([
			['d', 100],
			['b', 300],
			['e', 200]
		]);
		expect(sortByLastUsed(apps, (id) => id, lastUsed)).toEqual(['b', 'e', 'd', 'a', 'c']);
	});

	it('keeps the given order when nothing was used', () => {
		expect(sortByLastUsed(['x', 'y'], (id) => id, new Map())).toEqual(['x', 'y']);
	});
});
