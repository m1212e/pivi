// Profiles over GraphQL. The profile picker and login screen live query
// the user list, so it updates when a profile is created.
import { abilityBuilder, object, pubsub, query, schemaBuilder } from '../rumble';
import { setProfileLocale } from '../profileLocale';

// Anyone can list profiles (the picker shows them before login), but never the
// PIN hash.
abilityBuilder.user.allow('read').when({
	where: {},
	columns: {
		id: true,
		createdAt: true,
		image: true,
		pinHash: false,
		updatedAt: true,
		username: true,
		locale: true
	}
});

// A logged in user can only change or delete their own profile.
abilityBuilder.user.allow(['update', 'delete']).when((context) => {
	if (!context.user) return undefined;
	return { where: { id: { eq: context.user.id } } };
});

const UserRef = object({ table: 'user' });
query({ table: 'user' });

// The active profile is a single global row (see handleActiveProfile in
// hooks.server.ts), so the client asks for "me" rather than needing its id
// handed over by a page `load`.
schemaBuilder.queryFields((t) => ({
	me: t.field({ type: UserRef, nullable: true, resolve: (_root, _args, ctx) => ctx.user ?? null })
}));

// The language picker saves the choice to the logged in profile (see
// hooks.client.ts). False when nobody is logged in: the device cookie alone applies.
schemaBuilder.mutationFields((t) => ({
	setProfileLocale: t.field({
		type: 'Boolean',
		args: { locale: t.arg.string({ required: true }) },
		resolve: async (_root, args, ctx) => {
			if (!ctx.user) return false;
			await setProfileLocale(ctx.user.id, args.locale);
			return true;
		}
	})
}));
// Used by auth.ts to announce a newly created profile.
export const userPubsub = pubsub({ table: 'user' });
