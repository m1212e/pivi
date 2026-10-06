import { sql } from 'drizzle-orm';
import cron from 'node-cron';
import { db } from './db';
import { pairedDevice } from './db/schema';

// A phone that hasn't reconnected in a month is treated as lost or abandoned,
// so its pairing keys stop being accepted by the relay.
async function expireStaleDevices() {
	const result = await db
		.delete(pairedDevice)
		.where(
			sql`coalesce(${pairedDevice.lastSeenAt}, ${pairedDevice.createdAt}) < now() - interval '1 month'`
		)
		.returning({ id: pairedDevice.id });

	if (result.length > 0) console.log(`Expired ${result.length} stale paired device(s)`);
}

// Guard lives on globalThis because dev HMR re-evaluates this module, which
// would otherwise stack up cron jobs.
declare global {
	var __piviDeviceCleanupStarted: boolean | undefined;
}

/**
 * Started once from handlers/register.ts so stale pairings expire without
 * user action. Repeat calls are ignored.
 */
export function startDeviceCleanupSchedule() {
	if (globalThis.__piviDeviceCleanupStarted) return;
	globalThis.__piviDeviceCleanupStarted = true;

	void expireStaleDevices();
	cron.schedule('0 * * * *', () => void expireStaleDevices());
}
