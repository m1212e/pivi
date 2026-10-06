import { GraphQLError } from 'graphql';
import type { RequestEvent } from '@sveltejs/kit';

// Passed to rumble (rumble.ts) as the per request GraphQL context, so resolvers
// see `event.locals` (active user, pairing info) set by hooks.server.ts and can
// guard fields that need a logged in profile.
export function context(event: RequestEvent) {
	return {
		event,
		...event.locals,
		mustBeLoggedIn: () => {
			if (!event.locals.user) {
				throw new GraphQLError('Must be logged in');
			}

			return event.locals.user;
		}
	};
}
