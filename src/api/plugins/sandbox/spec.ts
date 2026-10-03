// Turns "this plugin, for this profile, with what the user switched on" into the
// sandbox it runs in. This is the one place permissions become enforcement, so
// it's a pure function: a permission that isn't granted simply doesn't appear in
// the spec, and the backend can't grant what it isn't told about.
import { createHash } from 'node:crypto';
import type { PermissionKey, PluginManifest } from '#lib/plugins/manifest';
import type { ImageRef } from '#lib/plugins/imageRef';
import type { PluginImage } from '../image';
import { pinnedReference } from '../registry';
import type { SandboxSpec, VolumeSpec } from './types';

// Every plugin gets the same ceiling for now; a plugin needing more is a
// manifest field to add once one does.
const RESOURCE_LIMITS = { memoryMiB: 256, cpus: 1 } as const;
const STORAGE_QUOTA_MIB = 256;
const CACHE_QUOTA_MIB = 512;

export const SANDBOX_PREFIX = 'pivi-';

function sandboxName(pluginId: string): string {
	return `${SANDBOX_PREFIX}${pluginId}`;
}

// A short, name-safe stand-in for the profile id.
function profileKey(userId: string): string {
	return createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

// Fields are joined with `_`, which a plugin id (lowercase letters, digits and
// dashes) can never contain — so one plugin's volume names can't be mistaken for
// another's, e.g. `demo` for a plugin called `demo-two`.
export function volumeName(pluginId: string, userId: string, kind: 'storage' | 'cache'): string {
	return `${SANDBOX_PREFIX}${pluginId}_${profileKey(userId)}_${kind}`;
}

export const volumeBelongsToPlugin = (pluginId: string) => (name: string) =>
	name.startsWith(`${SANDBOX_PREFIX}${pluginId}_`);

export function buildSandboxSpec(input: {
	ref: ImageRef;
	image: PluginImage;
	manifest: PluginManifest;
	// What the user has switched on. Anything the manifest never asked for is
	// ignored, so a stale grant can't outlive an update that dropped it.
	granted: readonly PermissionKey[];
	userId: string;
}): SandboxSpec {
	const { ref, image, manifest, userId } = input;
	const granted = new Set(input.granted.filter((key) => manifest.permissions.includes(key)));

	const volumes: VolumeSpec[] = [];
	if (granted.has('storage')) {
		volumes.push({
			guestPath: '/storage',
			name: volumeName(manifest.id, userId, 'storage'),
			quotaMiB: STORAGE_QUOTA_MIB
		});
	}
	if (granted.has('cache')) {
		volumes.push({
			guestPath: '/cache',
			name: volumeName(manifest.id, userId, 'cache'),
			quotaMiB: CACHE_QUOTA_MIB
		});
	}

	return {
		name: sandboxName(manifest.id),
		image: pinnedReference(ref, image.digest),
		command: image.command,
		workingDir: image.workingDir,
		...RESOURCE_LIMITS,
		network:
			granted.has('network') && manifest.network ? { domains: manifest.network.domains } : null,
		volumes
	};
}
