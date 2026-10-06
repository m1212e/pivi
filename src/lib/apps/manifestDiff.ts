// Lets app updates apply silently only when they ask for nothing new, since the
// user's approval covered the old manifest's access, not the new one's.
import { domainsAllow, type PermissionKey, type AppManifest } from './manifest';

/**
 * Whether an update's domain was already approved, so it isn't shown as new.
 * Unlike domainsAllow, a wildcard is only covered by an equal or broader
 * wildcard: approving `a.example.com` says nothing about `*.example.com`.
 */
export function domainCovered(approved: readonly string[], candidate: string): boolean {
	if (!candidate.startsWith('*.')) return domainsAllow(approved, candidate);

	const suffix = candidate.slice(2).toLowerCase();
	return approved.some((entry) => {
		if (!entry.startsWith('*.')) return false;
		const approvedSuffix = entry.slice(2).toLowerCase();
		return suffix === approvedSuffix || suffix.endsWith(`.${approvedSuffix}`);
	});
}

/** What an update asks for beyond the approval, shown to the user on the /apps screen. */
export type ManifestChange = {
	addedPermissions: PermissionKey[];
	addedDomains: string[];
	protocolChanged: boolean;
	needsApproval: boolean;
};

/**
 * Used by the updater and app state to decide whether a new version may
 * install on its own or has to wait for the user's approval.
 */
export function diffManifests(approved: AppManifest, next: AppManifest): ManifestChange {
	const addedPermissions = next.permissions.filter((key) => !approved.permissions.includes(key));
	const approvedDomains = approved.network?.domains ?? [];
	const addedDomains = (next.network?.domains ?? []).filter(
		(domain) => !domainCovered(approvedDomains, domain)
	);
	const protocolChanged = approved.protocol !== next.protocol;

	return {
		addedPermissions,
		addedDomains,
		protocolChanged,
		needsApproval: addedPermissions.length > 0 || addedDomains.length > 0 || protocolChanged
	};
}
