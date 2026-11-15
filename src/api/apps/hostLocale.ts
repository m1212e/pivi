// The locale apps are told to use (host/activate, host/locale): the language pivi's
// own interface shows, so an app never talks German next to an English pivi. That
// language is paraglide's decision for the TV's pages (the person's pick in the
// language picker, else the browser's preference), refined with the browser's
// region when it is the same language (`de` and `Accept-Language: de-AT` give
// `de-AT`), so numbers and dates are formatted the local way. PIVI_LOCALE pins
// it, and the system locale is the fallback before any page was opened. A logged in
// profile's own language (profileLocale.ts) arrives through the same paths: pages
// render in it, and login hands it over before the profile's apps start.
import { isLocale } from '@pivi/sdk/locale';

const listeners = new Set<(locale: string) => void>();
let current: string | undefined = process.env.PIVI_LOCALE || undefined;
// The TV browser's last Accept-Language, for the region of a language set without a request.
let lastAcceptLanguage: string | null = null;

/**
 * Sent to each app when it starts (runtime.ts), so its content is in the
 * user's language from the first screen.
 */
export function getHostLocale(): string {
	return current ?? (Intl.DateTimeFormat().resolvedOptions().locale || 'en-US');
}

/** Lets manager.ts forward a language change to apps that are already running. */
export function onHostLocaleChanged(listener: (locale: string) => void) {
	listeners.add(listener);
}

/** The browser's first preference, if it is a locale in `language`: its region is worth keeping. */
function regionalVariant(language: string, acceptLanguage: string | null): string | undefined {
	const first = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim();
	if (!first || !isLocale(first)) return undefined;
	const tag = Intl.getCanonicalLocales(first)[0]!;
	return new Intl.Locale(tag).language === new Intl.Locale(language).language ? tag : undefined;
}

/**
 * Fed by hooks.server.ts for every page the TV renders, with the language paraglide
 * chose for it and the request's Accept-Language. A no-op while PIVI_LOCALE pins it.
 */
export function noteHostLocale(uiLanguage: string, acceptLanguage: string | null) {
	lastAcceptLanguage = acceptLanguage;
	if (process.env.PIVI_LOCALE || !isLocale(uiLanguage)) return;
	const tag =
		regionalVariant(uiLanguage, acceptLanguage) ?? Intl.getCanonicalLocales(uiLanguage)[0]!;
	if (tag === current) return;
	current = tag;
	for (const listener of listeners) listener(tag);
}

/** A profile's stored language, on login or when it picks one, before any page shows it. */
export function noteProfileLocale(uiLanguage: string) {
	noteHostLocale(uiLanguage, lastAcceptLanguage);
}
