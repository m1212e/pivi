// Keeping installed plugins current. For each plugin, the tag it follows is
// resolved again; a different digest is a new version, which is only trusted if
// it carries a signature from the same key the plugin was installed with.
//
// A new version that asks for nothing more than the approved one is swapped in
// (when auto-update is on) and rolled back if it won't start. One that asks for
// more — a permission, a domain — is pulled and parked for the user to approve,
// and the old version keeps running meanwhile.
import { parseImageRef } from '#lib/plugins/imageRef';
import { diffManifests } from '#lib/plugins/manifestDiff';
import type { PluginDeps } from './deps';
import type { PluginImage } from './image';
import { PluginError } from './installer';
import { pinnedReference, resolveImage } from './registry';
import type { InstalledPlugin } from './store';

export type UpdateOutcome = 'unchanged' | 'applied' | 'pending' | 'ignored' | 'failed';

function referenceFor(row: InstalledPlugin, digest: string): string {
	return pinnedReference(parseImageRef(row.imageRef), digest);
}

// Swaps a plugin onto a new image. When it's running it's restarted straight
// away, and if the new version can't start the previous one is put back.
async function switchTo(
	deps: PluginDeps,
	row: InstalledPlugin,
	patch: Partial<InstalledPlugin>
): Promise<void> {
	const wasRunning = deps.control.isRunning(row.pluginId);
	await deps.store.update(row.pluginId, patch);
	if (!wasRunning) return;

	try {
		await deps.control.restart(row.pluginId);
	} catch (error) {
		await deps.store.update(row.pluginId, {
			name: row.name,
			version: row.version,
			imageDigest: row.imageDigest,
			imageCommand: row.imageCommand,
			imageWorkingDir: row.imageWorkingDir,
			approvedManifest: row.approvedManifest,
			grantedPermissions: row.grantedPermissions,
			pendingUpdate: row.pendingUpdate
		});
		await deps.control.restart(row.pluginId).catch(() => {});
		throw error;
	}
}

async function applyImage(
	deps: PluginDeps,
	row: InstalledPlugin,
	image: PluginImage,
	manifest: InstalledPlugin['approvedManifest']
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

export async function checkForUpdate(deps: PluginDeps, pluginId: string): Promise<UpdateOutcome> {
	const row = await deps.store.find(pluginId);
	if (!row) throw new PluginError(`No plugin "${pluginId}" is installed`);

	try {
		const ref = parseImageRef(row.imageRef);
		const resolved = await resolveImage(ref, deps.registry);
		await deps.store.update(pluginId, { lastCheckedAt: new Date() });

		if (resolved.digest === row.imageDigest) return 'unchanged';
		if (resolved.digest === row.ignoredDigest) return 'ignored';
		if (resolved.digest === row.pendingUpdate?.image.digest) return 'pending';

		// Whoever controls the tag doesn't control the key: a build that isn't
		// signed by the key this plugin was installed with is not an update.
		await deps.verify(ref, resolved.digest, row.signer, deps.registry);
		if (resolved.manifest.id !== row.pluginId) {
			throw new PluginError(`The new version is a different plugin (${resolved.manifest.id})`);
		}

		const image: PluginImage = {
			digest: resolved.digest,
			command: resolved.command,
			workingDir: resolved.workingDir
		};
		await deps.backend.prepare(pinnedReference(ref, resolved.digest));

		if (diffManifests(row.approvedManifest, resolved.manifest).needsApproval || !row.autoUpdate) {
			await deps.store.update(pluginId, {
				pendingUpdate: { manifest: resolved.manifest, image },
				lastError: null
			});
			return 'pending';
		}

		try {
			await applyImage(deps, row, image, resolved.manifest);
		} catch (error) {
			// Rolled back already; remembered so it isn't retried every check.
			await deps.store.update(pluginId, {
				ignoredDigest: resolved.digest,
				lastError: `Version ${resolved.manifest.version} failed to start and was rolled back: ${
					error instanceof Error ? error.message : error
				}`
			});
			return 'failed';
		}
		return 'applied';
	} catch (error) {
		await deps.store.update(pluginId, {
			lastError: error instanceof Error ? error.message : String(error)
		});
		return 'failed';
	}
}

// Every plugin, one after another: this runs in the background, and pulls are
// heavy enough that doing several at once would only slow each other down.
export async function checkAllForUpdates(deps: PluginDeps): Promise<Record<string, UpdateOutcome>> {
	const outcomes: Record<string, UpdateOutcome> = {};
	for (const row of await deps.store.list()) {
		outcomes[row.pluginId] = await checkForUpdate(deps, row.pluginId);
	}
	return outcomes;
}

export async function approvePendingUpdate(deps: PluginDeps, pluginId: string): Promise<void> {
	const row = await deps.store.find(pluginId);
	if (!row?.pendingUpdate) throw new PluginError('There is no update waiting for approval');
	await applyImage(deps, row, row.pendingUpdate.image, row.pendingUpdate.manifest);
}

export async function rejectPendingUpdate(deps: PluginDeps, pluginId: string): Promise<void> {
	const row = await deps.store.find(pluginId);
	if (!row?.pendingUpdate) return;
	await deps.store.update(pluginId, {
		pendingUpdate: null,
		ignoredDigest: row.pendingUpdate.image.digest
	});
	await deps.backend.removeImage(referenceFor(row, row.pendingUpdate.image.digest));
}
