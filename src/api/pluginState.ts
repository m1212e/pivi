// What the phone is shown about an installed plugin: the stored row turned into
// the shape of the `plugins/state` notification. Kept apart from the command
// handling so it can be tested without a relay.
import type { z } from 'zod';
import type { pluginsStateParamsSchema } from '#lib/pairing/remoteProtocol';
import { diffManifests } from '#lib/plugins/manifestDiff';
import type { InstalledPlugin } from './plugins/store';

export type PluginEntry = z.infer<typeof pluginsStateParamsSchema>['plugins'][number];

function describeUpdate(row: InstalledPlugin): PluginEntry['update'] {
	const pending = row.pendingUpdate;
	if (!pending) return null;

	const change = diffManifests(row.approvedManifest, pending.manifest);
	return {
		version: pending.manifest.version,
		addedPermissions: change.addedPermissions,
		addedDomains: change.addedDomains
	};
}

export function describePlugin(row: InstalledPlugin): PluginEntry {
	const manifest = row.approvedManifest;
	return {
		id: row.pluginId,
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
		signerFingerprint: row.signer.fingerprint,
		update: describeUpdate(row),
		error: row.lastError
	};
}
