// The installed-app table behind a small interface, so the install and
// update logic can be exercised without a database.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { installedApp } from '../db/schema';

export type InstalledApp = typeof installedApp.$inferSelect;
export type NewInstalledApp = typeof installedApp.$inferInsert;

export interface AppStore {
	list(): Promise<InstalledApp[]>;
	find(appId: string): Promise<InstalledApp | undefined>;
	insert(row: NewInstalledApp): Promise<void>;
	update(appId: string, patch: Partial<NewInstalledApp>): Promise<void>;
	remove(appId: string): Promise<void>;
}

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
