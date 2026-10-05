// What the TV's /apps screen is shown about an installed app: the stored
// row turned into the shape of `AppsState`. Kept apart from the GraphQL
// handling so it can be tested without a schema.
import type { AppsState } from '#lib/apps/management';
import { diffManifests } from '#lib/apps/manifestDiff';
import type { InstalledApp } from './apps/store';

export type AppEntry = AppsState['apps'][number];

function describeUpdate(row: InstalledApp): AppEntry['update'] {
	const pending = row.pendingUpdate;
	if (!pending) return null;

	const change = diffManifests(row.approvedManifest, pending.manifest);
	return {
		version: pending.manifest.version,
		addedPermissions: change.addedPermissions,
		addedDomains: change.addedDomains
	};
}

export function describeApp(row: InstalledApp): AppEntry {
	const manifest = row.approvedManifest;
	return {
		id: row.appId,
		name: row.name,
		version: row.version,
		image: row.imageRef,
		enabled: row.enabled,
		autoUpdate: row.autoUpdate,
		features: manifest.features,
		permissions: manifest.permissions.map((key) => ({
			key,
			granted: row.grantedPermissions.includes(key)
		})),
		domains: manifest.network?.domains ?? [],
		signerFingerprint: row.signer?.fingerprint ?? null,
		update: describeUpdate(row),
		error: row.lastError,
		icon: manifest.icon ?? null,
		primaryColor: manifest.primaryColor ?? null,
		secondaryColor: manifest.secondaryColor ?? null
	};
}
