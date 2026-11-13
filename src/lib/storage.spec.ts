import { describe, expect, it } from 'vitest';
import { readItem, writeItem, type KeyValueStorage } from './storage';

const memory = (): KeyValueStorage & { data: Record<string, string> } => {
	const data: Record<string, string> = {};
	return {
		data,
		getItem: (key) => data[key] ?? null,
		setItem: (key, value) => void (data[key] = value),
		removeItem: (key) => void delete data[key]
	};
};

const blocked: KeyValueStorage = {
	getItem: () => {
		throw new Error('blocked');
	},
	setItem: () => {
		throw new Error('blocked');
	},
	removeItem: () => {
		throw new Error('blocked');
	}
};

describe('storage helpers', () => {
	it('round trips a value and removes it with null', () => {
		const storage = memory();
		writeItem(storage, 'k', 'v');
		expect(readItem(storage, 'k')).toBe('v');
		writeItem(storage, 'k', null);
		expect(readItem(storage, 'k')).toBeNull();
	});

	it('tolerates missing and blocked storage', () => {
		for (const storage of [null, blocked]) {
			expect(readItem(storage, 'k')).toBeNull();
			expect(() => writeItem(storage, 'k', 'v')).not.toThrow();
		}
	});
});
