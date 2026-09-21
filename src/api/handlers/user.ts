import { db } from '../db';
import { abilityBuilder, object, query, schemaBuilder } from '../rumble';

// Public: the profile switcher lists every account before anyone is logged in.
abilityBuilder.user.allow('read');
abilityBuilder.user.allow(['update', 'delete']).when((context) => {
	if (!context.user) return undefined;
	return { where: { id: { eq: context.user.id } } };
});

// pinHash lives on the `user` table (see #api/db/schema) but must never leave
// the server — object({table:'user'}) below exposes every column it finds,
// so this filter strips it from every entity before the User type resolves.
abilityBuilder.user
	.filter('read')
	.by(({ entities }) => entities.map((entity) => ({ ...entity, pinHash: null })));

export const userRef = object({ table: 'user' });
query({ table: 'user' });

schemaBuilder.queryFields((t) => ({
	profiles: t.field({
		type: [userRef],
		resolve: () => db.query.user.findMany({ orderBy: { createdAt: 'asc' } })
	}),
	profileByUsername: t.field({
		type: userRef,
		nullable: true,
		args: { username: t.arg.string({ required: true }) },
		resolve: (_root, args) => db.query.user.findFirst({ where: { username: args.username } })
	}),
	me: t.field({
		type: userRef,
		nullable: true,
		resolve: (_root, _args, ctx) =>
			ctx.user ? db.query.user.findFirst({ where: { id: ctx.user.id } }) : null
	})
}));
