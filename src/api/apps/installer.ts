// Installing, configuring and removing apps. Every app is an OCI image,
// checked against a key the user supplied unless they chose to skip that.
// what it asks for is shown (the preview) before anything is stored, and
// what's stored is the user's answer, not the image's request.
import { formatImageRef, parseImageRef, type ImageRef } from '#lib/apps/imageRef';
import type { PermissionKey, AppManifest } from '#lib/apps/manifest';
import type { AppDeps } from './deps';
import { pinnedReference, resolveImage } from './registry';
import { volumeBelongsToApp, volumeName } from './sandbox/spec';
import { parseAppSigner, type AppSigner } from './signature';
import type { InstalledApp } from './store';

/** Marks errors whose message the app manager shows the user as is. */
export class AppError extends Error {}

/**
 * The permissions screen the user approves before anything is stored, so an
 * app never gets more than the user saw (appManagementService.ts).
 */
export type InstallPreview = {
	// Normalized, as it will be stored (the tag it will follow for updates).
	image: string;
	digest: string;
	manifest: AppManifest;
	// Null for an install without signature verification.
	signer: AppSigner | null;
	// Another app with this id is already installed.
	conflict: boolean;
};

// `publicKey` is optional: signature verification is left on by default, but
// a user who trusts the source another way (or has no key to paste) can skip
// it, same as `--insecure-skip-verify` elsewhere, at their own risk.
type InstallRequest = { image: string; publicKey?: string };

// Shared by preview and install so both run the same checks on the same input.
async function inspect(deps: AppDeps, request: InstallRequest) {
	const ref = parseImageRef(request.image);
	const signer = request.publicKey?.trim() ? parseAppSigner(request.publicKey) : null;
	const resolved = await resolveImage(ref, deps.registry);
	// Checked before anything about the image is shown or kept: an image that
	// isn't signed by that key is not a candidate at all. Skipped entirely for
	// an unsigned install.
	if (signer) await deps.verify(ref, resolved.digest, signer, deps.registry);
	return { ref, signer, resolved };
}

// The tag an app follows for updates. An image given by digest alone can't be
// updated, so it's rejected rather than installed as something frozen forever.
function updateTrack(ref: ImageRef): ImageRef {
	if (!ref.tag) throw new AppError('Give the image with a tag (e.g. :1.0) so it can be updated');
	return { registry: ref.registry, repository: ref.repository, tag: ref.tag };
}

/** Step one of the install flow in the app manager. Stores nothing. */
export async function previewInstall(
	deps: AppDeps,
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

/**
 * Step two, once the user approved the preview. `granted` is their answer. The
 * checks rerun rather than trusting the preview. Throws if the id is taken.
 */
export async function installApp(
	deps: AppDeps,
	request: InstallRequest & { granted: readonly PermissionKey[] }
): Promise<InstalledApp> {
	const { ref, signer, resolved } = await inspect(deps, request);
	const track = updateTrack(ref);
	const { manifest } = resolved;

	if (await deps.store.find(manifest.id)) {
		throw new AppError(`An app with the id "${manifest.id}" is already installed`);
	}

	// Pulled now, while the user is waiting for an install, so it can start later
	// without the network. Nothing is recorded if this fails.
	await deps.backend.prepare(pinnedReference(ref, resolved.digest));

	const row = {
		appId: manifest.id,
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

// One place for the not installed error the mutations below share.
async function requireInstalled(deps: AppDeps, appId: string): Promise<InstalledApp> {
	const row = await deps.store.find(appId);
	if (!row) throw new AppError(`No app "${appId}" is installed`);
	return row;
}

/**
 * The app manager's uninstall. Stops the app before removing the row, then
 * frees its volumes and pulled images, which would otherwise fill the TV's disk.
 */
export async function uninstallApp(deps: AppDeps, appId: string): Promise<void> {
	const row = await requireInstalled(deps, appId);
	await deps.control.stop(appId);
	await deps.store.remove(appId);
	await deps.backend.removeVolumes(volumeBelongsToApp(appId));
	await deps.backend.removeImage(pinnedReference(parseImageRef(row.imageRef), row.imageDigest));
	if (row.pendingUpdate) {
		await deps.backend.removeImage(
			pinnedReference(parseImageRef(row.imageRef), row.pendingUpdate.image.digest)
		);
	}
}

/**
 * Lets the user hide an app without losing its data. Disabling stops it right
 * away, enabling needs no start as apps boot on use.
 */
export async function setAppEnabled(deps: AppDeps, appId: string, enabled: boolean): Promise<void> {
	await requireInstalled(deps, appId);
	await deps.store.update(appId, { enabled });
	if (!enabled) await deps.control.stop(appId);
}

/**
 * The app manager's auto-update toggle. When off, updater.ts parks every new
 * version for approval.
 */
export async function setAppAutoUpdate(
	deps: AppDeps,
	appId: string,
	autoUpdate: boolean
): Promise<void> {
	await requireInstalled(deps, appId);
	await deps.store.update(appId, { autoUpdate });
}

/**
 * The app manager's per-permission toggles. Takes effect by stopping the app,
 * since what it may do is fixed when its sandbox is built.
 */
export async function setAppPermission(
	deps: AppDeps,
	appId: string,
	permission: PermissionKey,
	granted: boolean
): Promise<void> {
	const row = await requireInstalled(deps, appId);
	if (!row.approvedManifest.permissions.includes(permission)) {
		throw new AppError(`${row.name} does not ask for the "${permission}" permission`);
	}
	const without = row.grantedPermissions.filter((key) => key !== permission);
	await deps.store.update(appId, {
		grantedPermissions: granted ? [...without, permission] : without
	});
	await deps.control.stop(appId);
}

/**
 * Lets the user free what an app cached for the current profile. The cache is
 * disposable by contract, so this is always safe.
 */
export async function clearAppCache(deps: AppDeps, appId: string, userId: string): Promise<void> {
	await requireInstalled(deps, appId);
	await deps.control.stop(appId);
	const name = volumeName(appId, userId, 'cache');
	await deps.backend.removeVolumes((candidate) => candidate === name);
}

/**
 * Resets an app for the current profile, sign-in and saved settings included.
 * Unlike clearAppCache this loses real data, so AppManagerPanel.svelte
 * confirms first.
 */
export async function clearAppStorage(deps: AppDeps, appId: string, userId: string): Promise<void> {
	await requireInstalled(deps, appId);
	await deps.control.stop(appId);
	const name = volumeName(appId, userId, 'storage');
	await deps.backend.removeVolumes((candidate) => candidate === name);
}
