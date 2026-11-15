// The user's locale, as the host tells apps (host/activate, host/locale): a BCP 47
// language tag such as `de-DE`. It is the language pivi's own interface shows, with
// the region of the TV's browser when that is the same language, so an app formats
// numbers and dates the way the person expects. Browser-safe.
import { z } from 'zod';

/** Whether `value` is one well-formed BCP 47 language tag, by the platform's own definition. */
export function isLocale(value: string): boolean {
	try {
		return Intl.getCanonicalLocales(value).length === 1;
	} catch {
		return false;
	}
}

/** A BCP 47 language tag, canonicalized (`de-de` becomes `de-DE`). */
export const localeSchema = z
	.string()
	.max(256)
	.refine(isLocale, 'Expected a BCP 47 language tag like "de-DE"')
	.transform((tag) => Intl.getCanonicalLocales(tag)[0]!);

export type Locale = z.output<typeof localeSchema>;

/**
 * The best of an app's own translations for `locale`: the exact tag, else one with the
 * same language (`de-AT` picks `de` or `de-DE`), else `fallback`.
 *
 * @example
 * const messages = { en: …, de: … };
 * const lang = pickLocale(app.locale, ['en', 'de'], 'en'); // 'de' for 'de-AT'
 */
export function pickLocale<T extends string>(
	locale: string,
	available: readonly T[],
	fallback: T
): T {
	if (!isLocale(locale)) return fallback;
	const wanted = new Intl.Locale(locale);
	const parsed = available.filter(isLocale).map((tag) => [tag, new Intl.Locale(tag)] as const);
	const exact = parsed.find(([, l]) => l.baseName === wanted.baseName);
	if (exact) return exact[0];
	// A plain language tag (`de`) is the better match than another region (`de-CH`).
	const sameLanguage = parsed.filter(([, l]) => l.language === wanted.language);
	return (sameLanguage.find(([, l]) => !l.region) ?? sameLanguage[0])?.[0] ?? fallback;
}
