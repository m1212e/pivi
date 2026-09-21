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
	pinHash: text().notNull(),
	image: text()
});
