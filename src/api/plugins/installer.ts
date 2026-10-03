// Installing, configuring and removing plugins. Every plugin is an OCI image
// that has to be signed by a key the user supplied; what it asks for is shown
// (the preview) before anything is stored, and what's stored is the user's
// answer, not the image's request.
import { formatImageRef, parseImageRef, type ImageRef } from '#lib/plugins/imageRef';
import type { PermissionKey, PluginManifest } from '#lib/plugins/manifest';
import type { PluginDeps } from './deps';
import { pinnedReference, resolveImage } from './registry';
import { volumeBelongsToPlugin, volumeName } from './sandbox/spec';
import { parsePluginSigner, type PluginSigner } from './signature';
import type { InstalledPlugin } from './store';

export class PluginError extends Error {}

export type InstallPreview = {
	// Normalized, as it will be stored (the tag it will follow for updates).
	image: string;
	digest: string;
	manifest: PluginManifest;
	signer: PluginSigner;
	// Another plugin with this id is already installed.
	conflict: boolean;
};

type InstallRequest = { image: string; publicKey: string };

async function inspect(deps: PluginDeps, request: InstallRequest) {
	const ref = parseImageRef(request.image);
	const signer = parsePluginSigner(request.publicKey);
	const resolved = await resolveImage(ref, deps.registry);
	// Checked before anything about the image is shown or kept: an image that
	// isn't signed by that key is not a candidate at all.
	await deps.verify(ref, resolved.digest, signer, deps.registry);
	return { ref, signer, resolved };
}

// The tag a plugin follows for updates. An image given by digest alone can't be
// updated, so it's rejected rather than installed as something frozen forever.
function updateTrack(ref: ImageRef): ImageRef {
	if (!ref.tag) throw new PluginError('Give the image with a tag (e.g. :1.0) so it can be updated');
	return { registry: ref.registry, repository: ref.repository, tag: ref.tag };
}

export async function previewInstall(
	deps: PluginDeps,
	request: InstallRequest
): Promise<InstallPreview> {
	const { ref, signer, resolved } = await inspect(deps, request);
	return {
		image: formatImageRef(updateTrack(ref)),
		digest: resolved.digest,
		manifest: resolved.manifest,
		signer,
		conflict: (await deps.store.find(resolved.manifest.id)) !== undefined
	};
}

export async function installPlugin(
	deps: PluginDeps,
	request: InstallRequest & { granted: readonly PermissionKey[] }
): Promise<InstalledPlugin> {
	const { ref, signer, resolved } = await inspect(deps, request);
	const track = updateTrack(ref);
	const { manifest } = resolved;

	if (await deps.store.find(manifest.id)) {
		throw new PluginError(`A plugin with the id "${manifest.id}" is already installed`);
	}

	// Pulled now, while the user is waiting for an install, so it can start later
	// without the network. Nothing is recorded if this fails.
	await deps.backend.prepare(pinnedReference(ref, resolved.digest));

	const row = {
		pluginId: manifest.id,
		name: manifest.name,
		version: manifest.version,
		imageRef: formatImageRef(track),
		imageDigest: resolved.digest,
		imageCommand: resolved.command,
		imageWorkingDir: resolved.workingDir ?? null,
		signer,
		enabled: true,
		autoUpdate: true,
		approvedManifest: manifest,
		// Only what the manifest actually asked for can be granted.
		grantedPermissions: request.granted.filter((key) => manifest.permissions.includes(key)),
		pendingUpdate: null,
		ignoredDigest: null,
		lastCheckedAt: new Date(),
		lastError: null
	};
	await deps.store.insert(row);
	return (await deps.store.find(manifest.id))!;
}

async function requireInstalled(deps: PluginDeps, pluginId: string): Promise<InstalledPlugin> {
	const row = await deps.store.find(pluginId);
	if (!row) throw new PluginError(`No plugin "${pluginId}" is installed`);
	return row;
}

export async function uninstallPlugin(deps: PluginDeps, pluginId: string): Promise<void> {
	const row = await requireInstalled(deps, pluginId);
	await deps.control.stop(pluginId);
	await deps.store.remove(pluginId);
	await deps.backend.removeVolumes(volumeBelongsToPlugin(pluginId));
	await deps.backend.removeImage(pinnedReference(parseImageRef(row.imageRef), row.imageDigest));
	if (row.pendingUpdate) {
		await deps.backend.removeImage(
			pinnedReference(parseImageRef(row.imageRef), row.pendingUpdate.image.digest)
		);
	}
}

export async function setPluginEnabled(
	deps: PluginDeps,
	pluginId: string,
	enabled: boolean
): Promise<void> {
	await requireInstalled(deps, pluginId);
	await deps.store.update(pluginId, { enabled });
	if (!enabled) await deps.control.stop(pluginId);
}

export async function setPluginAutoUpdate(
	deps: PluginDeps,
	pluginId: string,
	autoUpdate: boolean
): Promise<void> {
	await requireInstalled(deps, pluginId);
	await deps.store.update(pluginId, { autoUpdate });
}

// Switching a permission takes effect by restarting the plugin: what it may do
// is fixed when its sandbox is built.
export async function setPluginPermission(
	deps: PluginDeps,
	pluginId: string,
	permission: PermissionKey,
	granted: boolean
): Promise<void> {
	const row = await requireInstalled(deps, pluginId);
	if (!row.approvedManifest.permissions.includes(permission)) {
		throw new PluginError(`${row.name} does not ask for the "${permission}" permission`);
	}
	const without = row.grantedPermissions.filter((key) => key !== permission);
	await deps.store.update(pluginId, {
		grantedPermissions: granted ? [...without, permission] : without
	});
	await deps.control.stop(pluginId);
}

// Drops everything the plugin cached for the current profile. Its cache volume
// is disposable by contract, so this is always safe; it just starts empty again.
export async function clearPluginCache(
	deps: PluginDeps,
	pluginId: string,
	userId: string
): Promise<void> {
	await requireInstalled(deps, pluginId);
	await deps.control.stop(pluginId);
	const name = volumeName(pluginId, userId, 'cache');
	await deps.backend.removeVolumes((candidate) => candidate === name);
}
