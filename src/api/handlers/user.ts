// Profiles over GraphQL. The profile picker and login screen live query
// the user list, so it updates when a profile is created.
import { abilityBuilder, object, pubsub, query, schemaBuilder } from '../rumble';

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
		username: true
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
// Used by auth.ts to announce a newly created profile.
export const userPubsub = pubsub({ table: 'user' });
