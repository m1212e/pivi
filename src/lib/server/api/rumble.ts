import { rumble } from '@m1212e/rumble';
import { db } from '#lib/server/db';
import * as schema from '#lib/server/db/schema';
import { context } from './context';

export const {
	abilityBuilder,
	schemaBuilder,
	whereArg,
	object,
	query,
	pubsub,
	createYoga,
	enum_
} = rumble({
	db,
	schema,
	context,
	defaultLimit: 100
});
