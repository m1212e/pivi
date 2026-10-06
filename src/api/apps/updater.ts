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
import { availabilityCache } from './availabilityCache';
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

// The badge's cached answer is dropped whenever this runs, since the outcome
// (applied, parked, rolled back) changes what it should say.
export async function checkForUpdate(deps: AppDeps, appId: string): Promise<UpdateOutcome> {
	try {
		return await runCheck(deps, appId);
	} finally {
		availabilityCache.forget(appId);
	}
}

type ImageRef = ReturnType<typeof parseImageRef>;
type ResolvedImage = Awaited<ReturnType<typeof resolveImage>>;

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// The outcome when the digest needs no work, undefined when it is new.
function knownOutcome(row: InstalledApp, digest: string): UpdateOutcome | undefined {
	if (digest === row.imageDigest) return 'unchanged';
	if (digest === row.ignoredDigest) return 'ignored';
	return digest === row.pendingUpdate?.image.digest ? 'pending' : undefined;
}

async function vetCandidate(
	deps: AppDeps,
	row: InstalledApp,
	ref: ImageRef,
	resolved: ResolvedImage
): Promise<void> {
	// Whoever controls the tag doesn't control the key: a build that isn't
	// signed by the key this app was installed with is not an update.
	// Skipped for an app that was installed without one.
	if (row.signer) await deps.verify(ref, resolved.digest, row.signer, deps.registry);
	if (resolved.manifest.id !== row.appId) {
		throw new AppError(`The new version is a different app (${resolved.manifest.id})`);
	}
}

async function tryApply(
	deps: AppDeps,
	row: InstalledApp,
	image: AppImage,
	resolved: ResolvedImage
): Promise<UpdateOutcome> {
	try {
		await applyImage(deps, row, image, resolved.manifest);
		return 'applied';
	} catch (error) {
		// Rolled back already; remembered so it isn't retried every check.
		await deps.store.update(row.appId, {
			ignoredDigest: resolved.digest,
			lastError: `Version ${resolved.manifest.version} failed to start and was rolled back: ${messageOf(error)}`
		});
		return 'failed';
	}
}

async function applyOrPark(
	deps: AppDeps,
	row: InstalledApp,
	resolved: ResolvedImage
): Promise<UpdateOutcome> {
	const image: AppImage = {
		digest: resolved.digest,
		command: resolved.command,
		workingDir: resolved.workingDir
	};
	if (diffManifests(row.approvedManifest, resolved.manifest).needsApproval || !row.autoUpdate) {
		await deps.store.update(row.appId, {
			pendingUpdate: { manifest: resolved.manifest, image },
			lastError: null
		});
		return 'pending';
	}
	return tryApply(deps, row, image, resolved);
}

async function checkRow(deps: AppDeps, row: InstalledApp): Promise<UpdateOutcome> {
	const ref = parseImageRef(row.imageRef);
	const resolved = await resolveImage(ref, deps.registry);
	await deps.store.update(row.appId, { lastCheckedAt: new Date() });

	const known = knownOutcome(row, resolved.digest);
	if (known) return known;

	await vetCandidate(deps, row, ref, resolved);
	await deps.backend.prepare(pinnedReference(ref, resolved.digest));
	return applyOrPark(deps, row, resolved);
}

async function runCheck(deps: AppDeps, appId: string): Promise<UpdateOutcome> {
	const row = await deps.store.find(appId);
	if (!row) throw new AppError(`No app "${appId}" is installed`);

	try {
		return await checkRow(deps, row);
	} catch (error) {
		await deps.store.update(appId, { lastError: messageOf(error) });
		return 'failed';
	}
}

const inFlight = new Set<string>();

// For callers that notice a new digest on their own (the home screen's badge
// check) and want it applied without waiting for the next scheduled run. A
// check already running for the app makes this a no-op, so repeated page loads
// can't stack up pulls or restarts.
export async function checkForUpdateOnce(
	deps: AppDeps,
	appId: string
): Promise<UpdateOutcome | undefined> {
	if (inFlight.has(appId)) return undefined;
	inFlight.add(appId);
	try {
		return await checkForUpdate(deps, appId);
	} finally {
		inFlight.delete(appId);
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
	availabilityCache.forget(appId);
}

export async function rejectPendingUpdate(deps: AppDeps, appId: string): Promise<void> {
	const row = await deps.store.find(appId);
	if (!row?.pendingUpdate) return;
	await deps.store.update(appId, {
		pendingUpdate: null,
		ignoredDigest: row.pendingUpdate.image.digest
	});
	await deps.backend.removeImage(referenceFor(row, row.pendingUpdate.image.digest));
	availabilityCache.forget(appId);
}
