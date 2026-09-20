import { pgTable, text } from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

// Single-row table: the one account currently selected on this device. Pivi
// runs on one Pi per TV on a trusted local network, so there's no notion of
// a per-browser session — picking a profile with its PIN sets this globally
// for every screen (and every paired remote) at once.
export const activeProfile = pgTable('active_profile', {
	id: text('id').primaryKey(),
	userId: text('user_id').references(() => user.id, { onDelete: 'cascade' })
});

export * from './auth.schema';
