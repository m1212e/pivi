import { abilityBuilder, object, query } from '../rumble';

// Any logged-in user may read any user's public profile; only edit themselves.
abilityBuilder.user.allow('read').when((context) => (context.user ? 'allow' : undefined));
abilityBuilder.user.allow(['update', 'delete']).when((context) => {
	if (!context.user) return undefined;
	return { where: { id: { eq: context.user.id } } };
});

object({ table: 'user' });
query({ table: 'user' });
