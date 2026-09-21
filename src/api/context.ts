import { GraphQLError } from 'graphql';
import type { RequestEvent } from '@sveltejs/kit';

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

export type Context = ReturnType<typeof context>;
