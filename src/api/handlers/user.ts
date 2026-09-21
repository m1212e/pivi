import { abilityBuilder, object, query } from '../rumble';

abilityBuilder.user.allow('read').when({
	where: {},
	columns: {
		id: true,
		createdAt: true,
		image: true,
		pinHash: false,
		updatedAt: true,
		username: true
	}
});

abilityBuilder.user.allow(['update', 'delete']).when((context) => {
	if (!context.user) return undefined;
	return { where: { id: { eq: context.user.id } } };
});

export const userRef = object({ table: 'user' });
query({ table: 'user' });
