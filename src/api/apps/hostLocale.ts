// The language and region apps are told to use. It follows the TV's browser
// (its Accept-Language), since that is the one place the person's language
// shows up, with PIVI_LOCALE as a fixed override and the system locale as the
// fallback before any page was opened.
const listeners = new Set<(locale: string) => void>();
let current: string | undefined = process.env.PIVI_LOCALE || undefined;

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

/**
 * Fed every request's Accept-Language by hooks.server.ts, which is how the
 * host learns the user's language at all. A no-op while PIVI_LOCALE pins it.
 */
export function noteBrowserLocale(acceptLanguage: string | null) {
	if (process.env.PIVI_LOCALE) return;
	const tag = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim();
	if (!tag || tag === current) return;
	try {
		// Throws on '*' and other things that are no locale.
		new Intl.Locale(tag);
	} catch {
		return;
	}
	current = tag;
	for (const listener of listeners) listener(tag);
}
