import { describe, expect, it, vi } from 'vitest';

// A fresh module per test: the current locale is module state.
function load() {
	vi.resetModules();
	delete process.env.PIVI_LOCALE;
	return import('./hostLocale');
}

describe('the locale apps are told', () => {
	it('is the language pivi shows, with the browser region when it is the same language', async () => {
		const { getHostLocale, noteHostLocale } = await load();
		noteHostLocale('de', 'de-AT,de;q=0.9,en;q=0.8');
		expect(getHostLocale()).toBe('de-AT');
	});

	it('follows the language picked in pivi over the browser language', async () => {
		const { getHostLocale, noteHostLocale } = await load();
		noteHostLocale('de', 'en-US,en;q=0.9');
		expect(getHostLocale()).toBe('de');
	});

	it('tells running apps when it changes, once', async () => {
		const { noteHostLocale, onHostLocaleChanged } = await load();
		const changes: string[] = [];
		onHostLocaleChanged((locale) => changes.push(locale));
		noteHostLocale('en', 'en-GB');
		noteHostLocale('en', 'en-GB');
		noteHostLocale('de', null);
		expect(changes).toEqual(['en-GB', 'de']);
	});

	it("switches to a profile's language before a page shows it, keeping the browser region", async () => {
		const { getHostLocale, noteHostLocale, noteProfileLocale } = await load();
		noteHostLocale('en', 'de-CH,de;q=0.9');
		expect(getHostLocale()).toBe('en');
		noteProfileLocale('de');
		expect(getHostLocale()).toBe('de-CH');
	});

	it('ignores what is no locale', async () => {
		const { getHostLocale, noteHostLocale } = await load();
		noteHostLocale('de', '*');
		expect(getHostLocale()).toBe('de');
	});
});
