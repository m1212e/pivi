import { abilityBuilder, object, pubsub, query, schemaBuilder } from '../rumble';

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
export const userPubsub = pubsub({ table: 'user' });
