import semver from 'semver';

/**
 * True only when both versions are valid semver and `candidate` is lower than
 * `installed`. Anything unparsable ('latest', dates, test builds) is never
 * treated as a downgrade, so unversioned apps keep updating by digest.
 */
export function isDowngrade(installed: string, candidate: string): boolean {
	const from = semver.valid(installed);
	const to = semver.valid(candidate);
	return from !== null && to !== null && semver.lt(to, from);
}
