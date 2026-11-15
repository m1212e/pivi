// Each profile keeps the interface language it picked (user.locale). While it is
// logged in, that language wins over the TV browser's cookie, for pivi's pages
// (the custom-profile paraglide strategy, hooks.server.ts) and for apps
// (apps/hostLocale.ts).
import { GraphQLError } from 'graphql';
import { eq } from 'drizzle-orm';
import { isLocale } from '#lib/paraglide/runtime';
import { getActiveProfileUser } from './activeProfile';
import { noteProfileLocale } from './apps/hostLocale';
import { db } from './db';
import { user } from './db/schema';

/** The active profile's language, if it picked one pivi has. */
export async function activeProfileLocale(): Promise<string | undefined> {
	const locale = (await getActiveProfileUser())?.locale;
	return locale && isLocale(locale) ? locale : undefined;
}

export async function setProfileLocale(userId: string, locale: string) {
	if (!isLocale(locale)) throw new GraphQLError(`Unknown language "${locale}"`);
	await db.update(user).set({ locale }).where(eq(user.id, userId));
	noteProfileLocale(locale);
}
