import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

// Only relations that rumble's GraphQL schema needs to walk go here. `session`
// and `account` are better-auth internals (tokens, credentials) — they're
// queried directly by better-auth's own adapter, not exposed through rumble,
// so they're deliberately left out of this relation graph.
export const relations = defineRelations(schema, (r) => ({
	user: {
		tasks: r.many.task({
			from: r.user.id,
			to: r.task.userId
		})
	},
	task: {
		user: r.one.user({
			from: r.task.userId,
			to: r.user.id
		})
	}
}));
