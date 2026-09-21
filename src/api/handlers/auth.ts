import { GraphQLError } from 'graphql';
import { clearActiveProfile, setActiveProfile } from './activeProfile';
import {
	InvalidCredentialsError,
	InvalidPinError,
	InvalidUsernameError,
	loginWithPin,
	registerWithPin,
	UsernameTakenError
} from '../auth-pin';
import { schemaBuilder } from '../rumble';

function toGraphQLError(err: unknown, fallback: string) {
	if (
		err instanceof InvalidPinError ||
		err instanceof InvalidUsernameError ||
		err instanceof UsernameTakenError ||
		err instanceof InvalidCredentialsError
	) {
		return new GraphQLError(err.message);
	}
	return new GraphQLError(fallback);
}

schemaBuilder.mutationFields((t) => ({
	register: t.field({
		type: 'Boolean',
		args: { username: t.arg.string({ required: true }), pin: t.arg.string({ required: true }) },
		resolve: async (_root, args) => {
			try {
				const createdUser = await registerWithPin(args.username, args.pin);
				await setActiveProfile(createdUser.id);
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
				const loggedInUser = await loginWithPin(args.username, args.pin);
				await setActiveProfile(loggedInUser.id);
				return true;
			} catch (err) {
				throw toGraphQLError(err, 'Wrong PIN');
			}
		}
	}),
	signOut: t.field({
		type: 'Boolean',
		resolve: async () => {
			await clearActiveProfile();
			return true;
		}
	})
}));
