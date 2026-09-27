import { rumble } from '@m1212e/rumble';
import { db } from './db';
import * as schema from './db/schema';
import { context } from './context';

// Only what this app actually uses: rumble returns more (whereArg, enum_) and
// binding those made them look like a public API of this module.
export const { abilityBuilder, schemaBuilder, object, query, pubsub, createYoga, clientCreator } =
	rumble({
		db,
		schema,
		context,
		defaultLimit: 100
	});
