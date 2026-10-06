// Whether a newer image is sitting on the registry for an installed app --
// used by the home screen's lightweight app tiles (src/api/handlers/apps.ts),
// which want to show an "update available" badge without waiting for the
// periodic updater (lifecycle.ts) to have already run and parked one in
// `row.pendingUpdate`. Nothing here is persisted: a manifest-digest check
// against the registry is cheap (no layers pulled, see registry.ts's
// resolveImage), so there's no need for a stored column just to answer "is
// there something newer," the way `pendingUpdate` is needed to remember
// *which* version and what it additionally asks for once the user has to
// approve it.
import { parseImageRef } from '#lib/apps/imageRef';
import type { AppDeps } from './deps';
import { availabilityCache } from './availabilityCache';
import { announceAppListChanged } from './events';
import { resolveImage } from './registry';
import { checkForUpdateOnce } from './updater';
import type { InstalledApp } from './store';

// Long enough that opening/refreshing the home screen repeatedly doesn't hit
// the registry once per app every time, short enough that a new release
// shows up on the tile without the user needing to do anything.
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function hasAvailableUpdate(deps: AppDeps, row: InstalledApp): Promise<boolean> {
	// Already known and parked for approval -- no need to ask the registry
	// again just to re-derive what's already sitting right there.
	if (row.pendingUpdate) return true;

	const cached = availabilityCache.get(row.appId);
	if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached.hasUpdate;

	// A registry that's briefly unreachable shouldn't flip the badge off --
	// keep showing whatever was last known until a check actually succeeds.
	let hasUpdate = cached?.hasUpdate ?? false;
	try {
		const ref = parseImageRef(row.imageRef);
		const resolved = await resolveImage(ref, deps.registry);
		hasUpdate = resolved.digest !== row.imageDigest && resolved.digest !== row.ignoredDigest;
	} catch {
		// Transient network/registry failure -- see `hasUpdate`'s fallback above.
	}

	availabilityCache.set(row.appId, { checkedAt: Date.now(), hasUpdate });

	// The scheduled check only runs every few hours, so an app that updates on
	// its own is applied right away instead of showing a badge until then.
	if (hasUpdate && row.autoUpdate) {
		void checkForUpdateOnce(deps, row.appId)
			.then(() => {
				announceAppListChanged();
			})
			.catch(() => {});
	}
	return hasUpdate;
}
