import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollEvery } from './poll';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pollEvery', () => {
	it('delivers each read', async () => {
		const seen: number[] = [];
		let n = 0;
		const stop = pollEvery(
			1000,
			() => Promise.resolve(++n),
			(v) => seen.push(v)
		);
		await vi.advanceTimersByTimeAsync(2000);
		stop();
		expect(seen).toEqual([1, 2]);
	});

	it('survives a failed read and keeps polling', async () => {
		const seen: string[] = [];
		const reads = [() => Promise.reject(new Error('down')), () => Promise.resolve('up')];
		const stop = pollEvery(
			1000,
			() => reads.shift()!(),
			(v) => seen.push(v)
		);
		await vi.advanceTimersByTimeAsync(2000);
		stop();
		expect(seen).toEqual(['up']);
	});

	it('does not overlap a slow read', async () => {
		let calls = 0;
		const stop = pollEvery(
			1000,
			() => {
				calls++;
				return new Promise<void>((resolve) => setTimeout(resolve, 2500));
			},
			() => {}
		);
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toBe(1);
		stop();
	});

	it('drops a result that lands after stop', async () => {
		const seen: number[] = [];
		const stop = pollEvery(
			1000,
			() => new Promise<number>((resolve) => setTimeout(() => resolve(1), 500)),
			(v) => seen.push(v)
		);
		await vi.advanceTimersByTimeAsync(1100);
		stop();
		await vi.advanceTimersByTimeAsync(1000);
		expect(seen).toEqual([]);
	});
});
