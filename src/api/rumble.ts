import { rumble } from '@m1212e/rumble';
import { db } from './db';
import * as schema from './db/schema';
import { context } from './context';

export const {
	abilityBuilder,
	schemaBuilder,
	whereArg,
	object,
	query,
	pubsub,
	createYoga,
	enum_,
	clientCreator
} = rumble({
	db,
	schema,
	context,
	defaultLimit: 100
});
