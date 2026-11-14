import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTtlCache } from './ttlCache';

describe('createTtlCache', () => {
	afterEach(() => vi.useRealTimers());

	it('forgets expired entries on write, not only when they are read again', () => {
		vi.useFakeTimers();
		const cache = createTtlCache<number>(1000);
		cache.set('old', 1);
		vi.advanceTimersByTime(1500);
		const spy = vi.spyOn(Map.prototype, 'delete');
		cache.set('new', 2);
		expect(spy).toHaveBeenCalledWith('old');
		spy.mockRestore();
		expect(cache.get('new')).toBe(2);
		expect(cache.get('old')).toBeUndefined();
	});
});
