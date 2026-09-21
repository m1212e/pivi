import { snakeCase, text, timestamp } from 'drizzle-orm/pg-core';
import { nanoid } from '../nanoid';

const defaultTimestamps = {
	createdAt: timestamp().defaultNow().notNull(),
	updatedAt: timestamp({ mode: 'date' })
		.defaultNow()
		.$onUpdate(() => new Date())
};

const defaultIdAndTimestamps = {
	id: text()
		.$defaultFn(() => nanoid())
		.primaryKey()
		.notNull(),
	...defaultTimestamps
};

export const user = snakeCase.table('user', {
	...defaultIdAndTimestamps,
	username: text().notNull().unique(),
	displayUsername: text().notNull(),
	image: text(),
	// Nullable so rumble's auto-generated GraphQL User type (which exposes
	// every column of the table passed to object({table:'user'})) treats this
	// as an optional field. The `user` read ability in #api/handlers/user
	// strips it from every entity before it reaches a resolver.
	pinHash: text()
});

export const activeProfile = snakeCase.table('active_profile', {
	id: text().primaryKey(),
	userId: text().references(() => user.id, { onDelete: 'cascade' })
});
