// What an update asks for beyond what the user already approved. A new version
// that only changes code is applied without asking (when auto-update is on); one
// that wants more access than before waits for the user, because the earlier
// approval was for the earlier ask.
import { domainsAllow, type PermissionKey, type AppManifest } from './manifest';

// Whether `candidate` (an exact host or `*.suffix`) is already within `approved`.
// A wildcard is only covered by an equal or broader wildcard: approving
// `a.example.com` says nothing about `*.example.com`.
export function domainCovered(approved: readonly string[], candidate: string): boolean {
	if (!candidate.startsWith('*.')) return domainsAllow(approved, candidate);

	const suffix = candidate.slice(2).toLowerCase();
	return approved.some((entry) => {
		if (!entry.startsWith('*.')) return false;
		const approvedSuffix = entry.slice(2).toLowerCase();
		return suffix === approvedSuffix || suffix.endsWith(`.${approvedSuffix}`);
	});
}

export type ManifestChange = {
	addedPermissions: PermissionKey[];
	addedDomains: string[];
	protocolChanged: boolean;
	// Whether the user has to approve before this runs.
	needsApproval: boolean;
};

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
