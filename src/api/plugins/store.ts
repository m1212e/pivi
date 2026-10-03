// The installed-plugin table behind a small interface, so the install and
// update logic can be exercised without a database.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { installedPlugin } from '../db/schema';

export type InstalledPlugin = typeof installedPlugin.$inferSelect;
export type NewInstalledPlugin = typeof installedPlugin.$inferInsert;

export interface PluginStore {
	list(): Promise<InstalledPlugin[]>;
	find(pluginId: string): Promise<InstalledPlugin | undefined>;
	insert(row: NewInstalledPlugin): Promise<void>;
	update(pluginId: string, patch: Partial<NewInstalledPlugin>): Promise<void>;
	remove(pluginId: string): Promise<void>;
}

export const dbPluginStore: PluginStore = {
	list: () => db.select().from(installedPlugin),

	async find(pluginId) {
		const [row] = await db
			.select()
			.from(installedPlugin)
			.where(eq(installedPlugin.pluginId, pluginId));
		return row;
	},

	async insert(row) {
		await db.insert(installedPlugin).values(row);
	},

	async update(pluginId, patch) {
		await db.update(installedPlugin).set(patch).where(eq(installedPlugin.pluginId, pluginId));
	},

	async remove(pluginId) {
		await db.delete(installedPlugin).where(eq(installedPlugin.pluginId, pluginId));
	}
};
