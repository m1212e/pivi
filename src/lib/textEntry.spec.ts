import { describe, expect, it } from 'vitest';
import { mirroredText, recordSent, type SentText } from './textEntry';

const tv = (textValue: string, hasTextInput = true) => ({ hasTextInput, textValue });

describe('mirroredText', () => {
	it('adopts what the TV shows when the phone did not send it', () => {
		expect(mirroredText(tv('from tv'), 'abc', [], 1000)).toBe('from tv');
	});

	it('keeps the phone text while the TV only echoes something sent a moment ago', () => {
		const sent: SentText[] = [
			{ value: 'a', at: 900 },
			{ value: 'ab', at: 950 }
		];
		expect(mirroredText(tv('a'), 'ab', sent, 1000)).toBe('ab');
	});

	it('treats the same value as a real TV edit once the echo window has passed', () => {
		const sent: SentText[] = [{ value: 'ab', at: 0 }];
		expect(mirroredText(tv('ab'), 'xyz', sent, 5000)).toBe('ab');
	});

	it('keeps the phone text when already in sync or without a field', () => {
		expect(mirroredText(tv('abc'), 'abc', [], 0)).toBe('abc');
		expect(mirroredText(tv('', false), 'abc', [], 0)).toBe('abc');
	});
});

describe('recordSent', () => {
	it('keeps recent entries and drops old ones', () => {
		const first = recordSent([], 'a', 0);
		const second = recordSent(first, 'ab', 1000);
		expect(second.map((s) => s.value)).toEqual(['a', 'ab']);
		const third = recordSent(second, 'abc', 2500);
		expect(third.map((s) => s.value)).toEqual(['ab', 'abc']);
	});
});
