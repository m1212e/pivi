import { describe, expect, it } from 'vitest';
import { withAppLock } from './appLock';
import { isDowngrade } from './versions';

describe('withAppLock', () => {
	it('runs tasks for one app one after another', async () => {
		const order: string[] = [];
		const slow = withAppLock('a', async () => {
			order.push('slow:start');
			await new Promise((resolve) => setTimeout(resolve, 20));
			order.push('slow:end');
		});
		const fast = withAppLock('a', () => {
			order.push('fast');
			return Promise.resolve();
		});
		await Promise.all([slow, fast]);
		expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
	});

	it('keeps running after a failed task and leaves other apps alone', async () => {
		const failed = withAppLock('a', () => Promise.reject(new Error('boom')));
		await expect(failed).rejects.toThrow('boom');
		await expect(withAppLock('a', () => Promise.resolve(1))).resolves.toBe(1);

		const order: string[] = [];
		const blocked = withAppLock('x', async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			order.push('x');
		});
		await withAppLock('y', () => {
			order.push('y');
			return Promise.resolve();
		});
		await blocked;
		expect(order).toEqual(['y', 'x']);
	});
});

describe('isDowngrade', () => {
	it('flags a lower valid semver only', () => {
		expect(isDowngrade('1.2.0', '1.1.9')).toBe(true);
		expect(isDowngrade('1.2.0', '1.2.0')).toBe(false);
		expect(isDowngrade('1.2.0', '2.0.0')).toBe(false);
	});

	it('never calls unparsable versions a downgrade', () => {
		expect(isDowngrade('latest', '1.0.0')).toBe(false);
		expect(isDowngrade('1.0.0', 'dev')).toBe(false);
		expect(isDowngrade('2026-11-01', '2026-10-01')).toBe(false);
	});
});
