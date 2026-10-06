// The installed-app table behind a small interface, so the install and
// update logic can be exercised without a database.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { installedApp } from '../db/schema';

/** An installed app as stored. Derived from the schema so it can't drift from the table. */
export type InstalledApp = typeof installedApp.$inferSelect;
/** What installApp writes, with the columns that have defaults left optional. */
export type NewInstalledApp = typeof installedApp.$inferInsert;

/** The seam installer.ts and updater.ts use, so their tests can run on an in-memory fake. */
export interface AppStore {
	list(): Promise<InstalledApp[]>;
	find(appId: string): Promise<InstalledApp | undefined>;
	insert(row: NewInstalledApp): Promise<void>;
	update(appId: string, patch: Partial<NewInstalledApp>): Promise<void>;
	remove(appId: string): Promise<void>;
}

/**
 * The real store, also read directly by manager.ts and the home screen
 * handlers. Kept free of logic so test fakes only have to match its shape.
 */
export const dbAppStore: AppStore = {
	list: () => db.select().from(installedApp),

	async find(appId) {
		const [row] = await db.select().from(installedApp).where(eq(installedApp.appId, appId));
		return row;
	},

	async insert(row) {
		await db.insert(installedApp).values(row);
	},

	async update(appId, patch) {
		await db.update(installedApp).set(patch).where(eq(installedApp.appId, appId));
	},

	async remove(appId) {
		await db.delete(installedApp).where(eq(installedApp.appId, appId));
	}
};
