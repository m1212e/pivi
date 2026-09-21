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

export const pairedDevice = snakeCase.table('paired_device', {
	...defaultIdAndTimestamps,
	publicKey: text().notNull(),
	name: text(),
	lastSeenAt: timestamp({ mode: 'date' })
});

export const tvIdentity = snakeCase.table('tv_identity', {
	id: text().primaryKey().notNull().default('singleton'),
	publicKey: text().notNull(),
	secretKey: text().notNull(),
	...defaultTimestamps
});
