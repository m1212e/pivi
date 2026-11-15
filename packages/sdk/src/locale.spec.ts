import { describe, expect, it } from 'vitest';
import { isLocale, localeSchema, pickLocale } from './locale';

describe('locales', () => {
	it('accepts and canonicalizes BCP 47 tags', () => {
		expect(localeSchema.parse('de-de')).toBe('de-DE');
		expect(localeSchema.parse('zh-hant-tw')).toBe('zh-Hant-TW');
		expect(isLocale('*')).toBe(false);
		expect(localeSchema.safeParse('not a locale').success).toBe(false);
	});

	it('pick the best translation an app has', () => {
		expect(pickLocale('de-AT', ['en', 'de'], 'en')).toBe('de');
		expect(pickLocale('de-AT', ['en', 'de-DE', 'de-AT'], 'en')).toBe('de-AT');
		expect(pickLocale('de-AT', ['de-CH', 'de'], 'en')).toBe('de');
		expect(pickLocale('fr-FR', ['en', 'de'], 'en')).toBe('en');
		expect(pickLocale('garbage!', ['en', 'de'], 'en')).toBe('en');
	});
});
