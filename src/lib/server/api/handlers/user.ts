import { abilityBuilder, object, query } from '../rumble';

// Public: the profile switcher lists every account before anyone is logged in.
abilityBuilder.user.allow('read');
abilityBuilder.user.allow(['update', 'delete']).when((context) => {
	if (!context.user) return undefined;
	return { where: { id: { eq: context.user.id } } };
});

object({ table: 'user' });
query({ table: 'user' });
