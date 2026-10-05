// Keeping installed apps current. For each app, the tag it follows is
// resolved again; a different digest is a new version, which is only trusted if
// it carries a signature from the same key the app was installed with.
//
// A new version that asks for nothing more than the approved one is swapped in
// (when auto-update is on) and rolled back if it won't start. One that asks for
// more — a permission, a domain — is pulled and parked for the user to approve,
// and the old version keeps running meanwhile.
import { parseImageRef } from '#lib/apps/imageRef';
import { diffManifests } from '#lib/apps/manifestDiff';
import type { AppDeps } from './deps';
import type { AppImage } from './image';
import { AppError } from './installer';
import { pinnedReference, resolveImage } from './registry';
import type { InstalledApp } from './store';

export type UpdateOutcome = 'unchanged' | 'applied' | 'pending' | 'ignored' | 'failed';

function referenceFor(row: InstalledApp, digest: string): string {
	return pinnedReference(parseImageRef(row.imageRef), digest);
}

// Swaps an app onto a new image. When it's running it's restarted straight
// away, and if the new version can't start the previous one is put back.
async function switchTo(
	deps: AppDeps,
	row: InstalledApp,
	patch: Partial<InstalledApp>
): Promise<void> {
	const wasRunning = deps.control.isRunning(row.appId);
	await deps.store.update(row.appId, patch);
	if (!wasRunning) return;

	try {
		await deps.control.restart(row.appId);
	} catch (error) {
		await deps.store.update(row.appId, {
			name: row.name,
			version: row.version,
			imageDigest: row.imageDigest,
			imageCommand: row.imageCommand,
			imageWorkingDir: row.imageWorkingDir,
			approvedManifest: row.approvedManifest,
			grantedPermissions: row.grantedPermissions,
			pendingUpdate: row.pendingUpdate
		});
		await deps.control.restart(row.appId).catch(() => {});
		throw error;
	}
}

async function applyImage(
	deps: AppDeps,
	row: InstalledApp,
	image: AppImage,
	manifest: InstalledApp['approvedManifest']
): Promise<void> {
	// What the user had switched on stays on, limited to what the new version
	// still asks for; anything it newly asks for is granted by approving.
	const kept = row.grantedPermissions.filter((key) => manifest.permissions.includes(key));
	const added = manifest.permissions.filter(
		(key) => !row.approvedManifest.permissions.includes(key)
	);

	await switchTo(deps, row, {
		name: manifest.name,
		version: manifest.version,
		imageDigest: image.digest,
		imageCommand: image.command,
		imageWorkingDir: image.workingDir ?? null,
		approvedManifest: manifest,
		grantedPermissions: [...kept, ...added],
		pendingUpdate: null,
		lastError: null
	});
	await deps.backend.removeImage(referenceFor(row, row.imageDigest));
}

export async function checkForUpdate(deps: AppDeps, appId: string): Promise<UpdateOutcome> {
	const row = await deps.store.find(appId);
	if (!row) throw new AppError(`No app "${appId}" is installed`);

	try {
		const ref = parseImageRef(row.imageRef);
		const resolved = await resolveImage(ref, deps.registry);
		await deps.store.update(appId, { lastCheckedAt: new Date() });

		if (resolved.digest === row.imageDigest) return 'unchanged';
		if (resolved.digest === row.ignoredDigest) return 'ignored';
		if (resolved.digest === row.pendingUpdate?.image.digest) return 'pending';

		// Whoever controls the tag doesn't control the key: a build that isn't
		// signed by the key this app was installed with is not an update.
		// Skipped for an app that was installed without one.
		if (row.signer) await deps.verify(ref, resolved.digest, row.signer, deps.registry);
		if (resolved.manifest.id !== row.appId) {
			throw new AppError(`The new version is a different app (${resolved.manifest.id})`);
		}

		const image: AppImage = {
			digest: resolved.digest,
			command: resolved.command,
			workingDir: resolved.workingDir
		};
		await deps.backend.prepare(pinnedReference(ref, resolved.digest));

		if (diffManifests(row.approvedManifest, resolved.manifest).needsApproval || !row.autoUpdate) {
			await deps.store.update(appId, {
				pendingUpdate: { manifest: resolved.manifest, image },
				lastError: null
			});
			return 'pending';
		}

		try {
			await applyImage(deps, row, image, resolved.manifest);
		} catch (error) {
			// Rolled back already; remembered so it isn't retried every check.
			await deps.store.update(appId, {
				ignoredDigest: resolved.digest,
				lastError: `Version ${resolved.manifest.version} failed to start and was rolled back: ${
					error instanceof Error ? error.message : error
				}`
			});
			return 'failed';
		}
		return 'applied';
	} catch (error) {
		await deps.store.update(appId, {
			lastError: error instanceof Error ? error.message : String(error)
		});
		return 'failed';
	}
}

// Every app, one after another: this runs in the background, and pulls are
// heavy enough that doing several at once would only slow each other down.
export async function checkAllForUpdates(deps: AppDeps): Promise<Record<string, UpdateOutcome>> {
	const outcomes: Record<string, UpdateOutcome> = {};
	for (const row of await deps.store.list()) {
		outcomes[row.appId] = await checkForUpdate(deps, row.appId);
	}
	return outcomes;
}

export async function approvePendingUpdate(deps: AppDeps, appId: string): Promise<void> {
	const row = await deps.store.find(appId);
	if (!row?.pendingUpdate) throw new AppError('There is no update waiting for approval');
	await applyImage(deps, row, row.pendingUpdate.image, row.pendingUpdate.manifest);
}

export async function rejectPendingUpdate(deps: AppDeps, appId: string): Promise<void> {
	const row = await deps.store.find(appId);
	if (!row?.pendingUpdate) return;
	await deps.store.update(appId, {
		pendingUpdate: null,
		ignoredDigest: row.pendingUpdate.image.digest
	});
	await deps.backend.removeImage(referenceFor(row, row.pendingUpdate.image.digest));
}
