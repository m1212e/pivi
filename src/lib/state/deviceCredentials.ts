// Persists this phone's paired-device identity across sessions. IndexedDB
// (not localStorage) because it survives an installed PWA reliably and can
// hold raw key bytes without base64 round-tripping every read.
import Dexie, { type EntityTable } from 'dexie';

export type DeviceCredentials = {
	deviceId: string;
	deviceSecretKey: Uint8Array;
	tvPublicKey: Uint8Array;
};

type StoredCredentials = DeviceCredentials & { id: typeof KEY };

const KEY = 'device-credentials';

const db = new Dexie('pivi') as Dexie & {
	credentials: EntityTable<StoredCredentials, 'id'>;
};
db.version(1).stores({ credentials: 'id' });

export async function getDeviceCredentials(): Promise<DeviceCredentials | null> {
	const row = await db.credentials.get(KEY);
	return row ?? null;
}

export async function setDeviceCredentials(credentials: DeviceCredentials): Promise<void> {
	await db.credentials.put({ ...credentials, id: KEY });
}

export async function clearDeviceCredentials(): Promise<void> {
	await db.credentials.delete(KEY);
}
