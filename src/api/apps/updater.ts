// Keeping installed apps current. For each app, the tag it follows is
// resolved again. A different digest is a new version, which is only trusted if
// it carries a signature from the same key the app was installed with.
//
// A signed new version that asks for nothing more than the approved one is
// swapped in (when auto-update is on) and rolled back if it won't start. One that asks for
// more (a permission, a domain) is pulled and parked for the user to approve,
// and the old version keeps running meanwhile.
import { parseImageRef } from '#lib/apps/imageRef';
import { diffManifests } from '#lib/apps/manifestDiff';
import { availabilityCache } from './availabilityCache';
import type { AppDeps } from './deps';
import type { AppImage } from './image';
import { AppError } from './installer';
import { pinnedReference, resolveImage } from './registry';
import type { InstalledApp } from './store';

/**
 * Reported per app so the app manager can summarize a manual check and the
 * hourly job (lifecycle.ts) can log what changed. 'ignored' is a digest the
 * user rejected or that failed to start before.
 */
export type UpdateOutcome = 'unchanged' | 'applied' | 'pending' | 'ignored' | 'failed';

// Pinned to a digest so removing an image never touches a different build.
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

// Shared by auto-apply and manual approval so both end in the same state.
async function applyImage(
	deps: AppDeps,
	row: InstalledApp,
	image: AppImage,
	manifest: InstalledApp['approvedManifest']
): Promise<void> {
	// What the user had switched on stays on, limited to what the new version
	// still asks for, and anything it newly asks for is granted by approving.
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

/**
 * The entry point every update path ends in, exported for tests. Drops the
 * badge's cached answer, since the outcome changes what it should say.
 */
export async function checkForUpdate(deps: AppDeps, appId: string): Promise<UpdateOutcome> {
	try {
		return await runCheck(deps, appId);
	} finally {
		availabilityCache.forget(appId);
	}
}

type ImageRef = ReturnType<typeof parseImageRef>;
type ResolvedImage = Awaited<ReturnType<typeof resolveImage>>;

// Stored in lastError, which the UI shows as text.
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// The outcome when the digest needs no work, undefined when it is new.
function knownOutcome(row: InstalledApp, digest: string): UpdateOutcome | undefined {
	if (digest === row.imageDigest) return 'unchanged';
	if (digest === row.ignoredDigest) return 'ignored';
	return digest === row.pendingUpdate?.image.digest ? 'pending' : undefined;
}

// Checks that the new build is genuinely this app before it's pulled.
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

// A build that won't start must not keep failing on every check.
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
		// Rolled back already, and remembered so it isn't retried every check.
		await deps.store.update(row.appId, {
			ignoredDigest: resolved.digest,
			lastError: `Version ${resolved.manifest.version} failed to start and was rolled back: ${messageOf(error)}`
		});
		return 'failed';
	}
}

// Anything that widens what the user approved has to wait for them. So does
// any new build of an unsigned app, since nothing proves it came from the same
// publisher and whoever controls the tag could otherwise swap the code freely.
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
	if (
		!row.signer ||
		!row.autoUpdate ||
		diffManifests(row.approvedManifest, resolved.manifest).needsApproval
	) {
		await deps.store.update(row.appId, {
			pendingUpdate: { manifest: resolved.manifest, image },
			lastError: null
		});
		return 'pending';
	}
	return tryApply(deps, row, image, resolved);
}

// Pulls before applying or parking, so either way the new build can later
// start without the network.
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

// Errors are recorded on the row and reported as 'failed' so one broken app
// doesn't abort a check of all apps.
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

// Apps with a check running right now, see checkForUpdateOnce.
const inFlight = new Set<string>();

/**
 * Lets the home screen's badge check (updateAvailability.ts) apply an update it
 * spotted without waiting for the hourly run. A no-op while a check for the app
 * is running, so repeated page loads can't stack up pulls or restarts.
 */
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

/**
 * Behind the hourly job (lifecycle.ts) and the app manager's "check for
 * updates". Apps go one at a time since parallel pulls only slow each other down.
 */
export async function checkAllForUpdates(deps: AppDeps): Promise<Record<string, UpdateOutcome>> {
	const outcomes: Record<string, UpdateOutcome> = {};
	for (const row of await deps.store.list()) {
		outcomes[row.appId] = await checkForUpdate(deps, row.appId);
	}
	return outcomes;
}

/**
 * The app manager's approve button for a parked update, which is the user's
 * consent to whatever the new version asks for in addition.
 */
export async function approvePendingUpdate(deps: AppDeps, appId: string): Promise<void> {
	const row = await deps.store.find(appId);
	if (!row?.pendingUpdate) throw new AppError('There is no update waiting for approval');
	await applyImage(deps, row, row.pendingUpdate.image, row.pendingUpdate.manifest);
	availabilityCache.forget(appId);
}

/**
 * The app manager's reject button. Remembers the digest so the same version
 * isn't parked again at the next check.
 */
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
