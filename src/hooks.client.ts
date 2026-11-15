import { client } from '#lib/api/rumbleClient/client';
import { defineCustomClientStrategy, isLocale } from '#lib/paraglide/runtime';
import { REMOTE_PREFIX } from '#lib/routes';

// The server already decided the language (the logged in profile's, else the
// device cookie, see hooks.server.ts) and rendered it into <html lang>, so the
// client reads it from there. Picking a language saves it to the logged in
// profile before paraglide reloads; the cookie strategy keeps it for the device.
defineCustomClientStrategy('custom-profile', {
	getLocale: () => {
		const lang = document.documentElement.lang;
		return isLocale(lang) ? lang : undefined;
	},
	setLocale: async (locale) => {
		if (location.pathname.startsWith(REMOTE_PREFIX)) return;
		await client.mutate.setProfileLocale({ __args: { locale } });
	}
});
