import { describe, expect, it } from 'vitest';
import { usernameIssue } from './usernameRules';

describe('usernameIssue', () => {
	it('accepts letters, digits, dash and underscore within the length', () => {
		for (const name of ['ab', 'Anna_Lena-2', 'a'.repeat(20)]) {
			expect(usernameIssue(name)).toBeUndefined();
		}
	});

	it('names the first problem', () => {
		expect(usernameIssue('a')).toBe('too_short');
		expect(usernameIssue('')).toBe('too_short');
		expect(usernameIssue('a'.repeat(21))).toBe('too_long');
		expect(usernameIssue('no spaces')).toBe('invalid_chars');
		expect(usernameIssue('ümlaut')).toBe('invalid_chars');
	});
});
