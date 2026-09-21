import { schemaBuilder } from '../rumble';

schemaBuilder.mutationFields((t) => ({
	// register: t.field({
	// 	type: 'Boolean',
	// 	args: { username: t.arg.string({ required: true }), pin: t.arg.string({ required: true }) },
	// 	resolve: async (_root, args) => {
	// 		try {
	// 			const createdUser = await registerWithPin(args.username, args.pin);
	// 			setActiveProfile(createdUser.id);
	// 			return true;
	// 		} catch (err) {
	// 			throw toGraphQLError(err, 'Could not create profile');
	// 		}
	// 	}
	// }),
	// login: t.field({
	// 	type: 'Boolean',
	// 	args: { userId: t.arg.string({ required: true }), pin: t.arg.string({ required: true }) },
	// 	resolve: async (_root, args) => {
	// 		try {
	// 			const loggedInUser = await loginWithPin(args.userId, args.pin);
	// 			setActiveProfile(loggedInUser.id);
	// 			return true;
	// 		} catch (err) {
	// 			throw toGraphQLError(err, 'Wrong PIN');
	// 		}
	// 	}
	// }),
	// logout: t.field({
	// 	type: 'Boolean',
	// 	resolve: () => {
	// 		clearActiveProfile();
	// 		return true;
	// 	}
	// })
}));
