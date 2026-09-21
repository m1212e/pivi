import { GraphQLError } from 'graphql';
import { ZodError } from 'zod';
import { AuthError, loginWithPin, logout, registerWithPin } from '../auth';
import { schemaBuilder } from '../rumble';
import { credentialsSchema } from '../validation';

function toGraphQLError(err: unknown, fallback: string) {
	if (err instanceof ZodError) return new GraphQLError(err.issues[0]?.message ?? fallback);
	if (err instanceof AuthError) return new GraphQLError(err.message);
	return new GraphQLError(fallback);
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
