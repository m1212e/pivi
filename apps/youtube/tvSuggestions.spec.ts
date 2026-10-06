import { describe, expect, it } from 'vitest';
import { parseSuggestions } from './tvSuggestions';

describe('parseSuggestions', () => {
	it('reads the texts out of the JSONP answer', () => {
		const body =
			'window.google.ac.h(["mar",[["marco scm",0,[512]],["mario odyssey",0,[512],{"zae":"x"}]],{"k":1}])';
		expect(parseSuggestions(body)).toEqual(['marco scm', 'mario odyssey']);
	});

	it('drops duplicates and caps the list', () => {
		const entries = Array.from({ length: 12 }, (_, i) => [`s${i % 9}`, 0]);
		expect(parseSuggestions(`h(["q",${JSON.stringify(entries)}])`)).toHaveLength(6);
	});

	it('returns nothing for an answer without suggestions', () => {
		expect(parseSuggestions('')).toEqual([]);
		expect(parseSuggestions('h(["q"])')).toEqual([]);
	});
});
