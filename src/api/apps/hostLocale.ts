// The language and region apps are told to use. It follows the TV's browser
// (its Accept-Language), since that is the one place the person's language
// shows up, with PIVI_LOCALE as a fixed override and the system locale as the
// fallback before any page was opened.
const listeners = new Set<(locale: string) => void>();
let current: string | undefined = process.env.PIVI_LOCALE || undefined;

export function getHostLocale(): string {
	return current ?? (Intl.DateTimeFormat().resolvedOptions().locale || 'en-US');
}

export function onHostLocaleChanged(listener: (locale: string) => void) {
	listeners.add(listener);
}

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
