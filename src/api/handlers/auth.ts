import { GraphQLError } from 'graphql';
import { ZodError } from 'zod';
import { AuthError, loginWithPin, logout, registerWithPin } from '../auth';
import { schemaBuilder } from '../rumble';
import { credentialsSchema } from '../validation';

// The message a given failure should surface, or undefined to fall back. A
// ZodError's first issue is the one worth showing; an AuthError is already
// written for a person to read; anything else is unexpected and says nothing.
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
