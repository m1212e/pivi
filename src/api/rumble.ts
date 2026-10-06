import { rumble } from '@m1212e/rumble';
import { db } from './db';
import * as schema from './db/schema';
import { context } from './context';

// The one rumble instance. Handlers register their fields on it and api.ts
// turns it into the yoga server. Only the parts this app uses are exported,
// so the rest of rumble's return value doesn't look like a public API.
export const { abilityBuilder, schemaBuilder, object, query, pubsub, createYoga, clientCreator } =
	rumble({
		db,
		schema,
		context,
		defaultLimit: 100
	});
