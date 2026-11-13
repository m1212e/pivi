import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReconnector, reconnectDelayMs } from './reconnect';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('reconnectDelayMs', () => {
	it('doubles and caps', () => {
		expect([0, 1, 2, 3].map(reconnectDelayMs)).toEqual([500, 1000, 2000, 4000]);
		expect(reconnectDelayMs(10)).toBe(10_000);
	});
});

describe('createReconnector', () => {
	it('retries with growing delays until connected', () => {
		const connect = vi.fn();
		const r = createReconnector(connect);
		r.lost();
		vi.advanceTimersByTime(499);
		expect(connect).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(connect).toHaveBeenCalledTimes(1);
		r.lost();
		vi.advanceTimersByTime(999);
		expect(connect).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		expect(connect).toHaveBeenCalledTimes(2);
	});

	it('starts over after a successful connection', () => {
		const connect = vi.fn();
		const r = createReconnector(connect);
		r.lost();
		vi.advanceTimersByTime(500);
		r.connected();
		r.lost();
		vi.advanceTimersByTime(500);
		expect(connect).toHaveBeenCalledTimes(2);
	});

	it('does nothing after stop', () => {
		const connect = vi.fn();
		const r = createReconnector(connect);
		r.lost();
		r.stop();
		r.lost();
		vi.advanceTimersByTime(60_000);
		expect(connect).not.toHaveBeenCalled();
	});
});
