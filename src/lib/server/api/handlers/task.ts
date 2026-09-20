import { abilityBuilder, schemaBuilder, object, query } from '../rumble';
import { db } from '#lib/server/db';
import * as schema from '#lib/server/db/schema';
import { GraphQLError } from 'graphql';
import type { Context } from '../context';

// A logged-in user may read, update or delete only their own tasks.
abilityBuilder.task.allow(['read', 'update', 'delete']).when((context: Context) => {
	if (!context.user) return undefined;
	return { where: { userId: { eq: context.user.id } } };
});

const TaskRef = object({ table: 'task' });
query({ table: 'task' });

schemaBuilder.mutationFields((t) => ({
	createTask: t.drizzleField({
		type: TaskRef,
		args: {
			title: t.arg.string({ required: true }),
			priority: t.arg.int({ required: false })
		},
		resolve: async (query, _root, args, ctx) => {
			const user = ctx.mustBeLoggedIn();

			const [created] = await db
				.insert(schema.task)
				.values({
					title: args.title,
					priority: args.priority ?? undefined,
					userId: user.id
				})
				.returning({ id: schema.task.id });

			if (!created) throw new GraphQLError('Failed to create task');

			const row = await db.query.task.findFirst(
				query({ where: { id: { eq: created.id } } })
			);
			if (!row) throw new GraphQLError('Task not found after creation');
			return row;
		}
	})
}));
