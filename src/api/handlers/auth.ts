import { GraphQLError } from 'graphql';
import { ZodError } from 'zod';
import { AuthError, loginWithPin, logout, registerWithPin } from '../auth';
import { schemaBuilder } from '../rumble';
import { credentialsSchema } from '../validation';

// Login and profile creation. Errors are mapped to short messages the PIN pad
// can show, never the raw cause.

// Only validation and AuthError messages are written for a person, anything
// else falls back to a generic message so internals don't leak.
function errorMessage(err: unknown): string | undefined {
	if (err instanceof ZodError) return err.issues[0]?.message;
	return err instanceof AuthError ? err.message : undefined;
}

function toGraphQLError(err: unknown, fallback: string) {
	return new GraphQLError(errorMessage(err) ?? fallback);
}

schemaBuilder.mutationFields((t) => ({
	register: t.field({
		type: 'Boolean',
		args: { username: t.arg.string({ required: true }), pin: t.arg.string({ required: true }) },
		resolve: async (_root, args) => {
			try {
				const input = credentialsSchema.parse(args);
				await registerWithPin(input.username, input.pin);
				return true;
			} catch (err) {
				throw toGraphQLError(err, 'Could not create profile');
			}
		}
	}),
	login: t.field({
		type: 'Boolean',
		args: { username: t.arg.string({ required: true }), pin: t.arg.string({ required: true }) },
		resolve: async (_root, args) => {
			try {
				const input = credentialsSchema.parse(args);
				await loginWithPin(input.username, input.pin);
				return true;
			} catch (err) {
				throw toGraphQLError(err, 'Wrong PIN');
			}
		}
	}),
	signOut: t.field({
		type: 'Boolean',
		resolve: () => {
			logout();
			return true;
		}
	})
}));
