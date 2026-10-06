import { describe, expect, it } from 'vitest';
import { credentialsSchema } from './validation';

describe('credentialsSchema', () => {
	it('trims the username and accepts a valid pair', () => {
		expect(credentialsSchema.parse({ username: '  anna ', pin: '1234' })).toEqual({
			username: 'anna',
			pin: '1234'
		});
	});

	it('reports the shared username rules in plain English', () => {
		const message = (username: string) => {
			const result = credentialsSchema.safeParse({ username, pin: '1234' });
			return result.success ? null : result.error.issues[0].message;
		};
		expect(message('a')).toBe('Username is too short');
		expect(message('a'.repeat(21))).toBe('Username is too long');
		expect(message('bad name')).toBe('Only letters, numbers, - and _ are allowed');
	});

	it('requires a four digit pin', () => {
		expect(credentialsSchema.safeParse({ username: 'anna', pin: '12' }).success).toBe(false);
	});
});
