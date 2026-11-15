// How an install in flight (management.ts's AppInstall) is described, shared by
// the /apps screen's progress bar and the home screen's pending tile.
import type { AppInstall } from './management';
import * as m from '#lib/paraglide/messages';

/** 0..1 while downloading with a known size, null when it can't be told (show a spinner). */
export function installFraction(install: AppInstall): number | null {
	if (install.phase === 'unpacking') return 1;
	if (install.phase !== 'downloading' || !install.totalBytes) return null;
	return Math.min(1, install.downloadedBytes / install.totalBytes);
}

const MiB = 1024 * 1024;
const formatMiB = (bytes: number) => (bytes / MiB).toFixed(bytes < 10 * MiB ? 1 : 0);

/** One line under the app's name: what it's doing, with the size when known. */
export function installLabel(install: AppInstall): string {
	switch (install.phase) {
		case 'checking':
			return m.apps_install_checking();
		case 'resolving':
			return m.apps_install_resolving();
		case 'unpacking':
			return m.apps_install_unpacking();
		case 'downloading':
			return install.totalBytes
				? m.apps_install_downloading_of({
						done: formatMiB(install.downloadedBytes),
						total: formatMiB(install.totalBytes)
					})
				: m.apps_install_downloading({ done: formatMiB(install.downloadedBytes) });
	}
}
