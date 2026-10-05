// The logic of managing apps: installing, configuring and updating them, for
// the TV's own screen (over GraphQL, see handlers/appManagement.ts, so apps
// can be managed with nothing but the remote's gestures and the phone's
// keyboard relay typing into whichever field has focus).
import type { AppsState as SharedAppsState } from '#lib/apps/management';
import type { PermissionKey } from '#lib/apps/manifest';
import { describeApp } from './appState';
import type { AppDeps } from './apps/deps';
import {
	clearAppCache,
	clearAppStorage,
	installApp,
	previewInstall,
	setAppAutoUpdate,
	setAppEnabled,
	setAppPermission,
	uninstallApp
} from './apps/installer';
import {
	approvePendingUpdate,
	checkAllForUpdates,
	rejectPendingUpdate,
	type UpdateOutcome
} from './apps/updater';

export type AppsState = SharedAppsState;
type Busy = NonNullable<AppsState['busy']>;

export type ManagementEvents = {
	// The state shown to the user changed (busy, error, preview, or the installed set).
	stateChanged(): void;
	// The installed set changed: the TV's own lists and dashboards need refreshing.
	listChanged(): void;
};

// `publicKey` is left out entirely to install unsigned -- signature checking is
// opt-in, not refused with an empty string.
type InstallRequest = { image: string; publicKey?: string };

export function createAppManagement(
	deps: AppDeps,
	events: ManagementEvents,
	activeUserId: () => Promise<string | null>
) {
	// Everything here that isn't derived from the database: what's in flight, the
	// last failure, and the preview awaiting the user's decision. Kept server-side
	// so a screen that reloads mid-install, or a second one, sees the same thing
	// as the one that started it.
	const session: Pick<AppsState, 'busy' | 'error' | 'preview' | 'lastCheckSummary'> = {
		busy: null,
		error: null,
		preview: null,
		lastCheckSummary: null
	};
	// What the preview was made from. Install refers to it rather than taking the
	// image and key again: a preview started on one screen is shown on the other,
	// and a screen's own fields can't be trusted to still hold what was typed (the
	// remote clears a field right after Enter).
	let previewed: InstallRequest | null = null;

	// Runs one operation: marks the service busy for its duration, turns a failure
	// into state the UI can show, and always ends by announcing the result.
	async function run(busy: Busy, action: () => Promise<void>): Promise<void> {
		session.busy = busy;
		session.error = null;
		events.stateChanged();

		try {
			await action();
		} catch (error) {
			session.error = error instanceof Error ? error.message : String(error);
		} finally {
			session.busy = null;
			events.listChanged();
			events.stateChanged();
		}
	}

	const forApp = (action: (appId: string) => Promise<void>) => (appId: string) =>
		run('working', () => action(appId));

	return {
		async state(): Promise<AppsState> {
			const rows = await deps.store.list();
			return { apps: rows.map(describeApp), ...session };
		},

		async preview(request: InstallRequest): Promise<void> {
			session.preview = null;
			previewed = null;
			await run('previewing', async () => {
				const preview = await previewInstall(deps, request);
				session.preview = {
					image: preview.image,
					name: preview.manifest.name,
					version: preview.manifest.version,
					features: preview.manifest.features,
					permissions: preview.manifest.permissions,
					domains: preview.manifest.network?.domains ?? [],
					signerFingerprint: preview.signer?.fingerprint ?? null,
					conflict: preview.conflict,
					icon: preview.manifest.icon ?? null,
					primaryColor: preview.manifest.primaryColor ?? null,
					secondaryColor: preview.manifest.secondaryColor ?? null
				};
				previewed = request;
			});
		},

		// Installs what was last previewed, with the permissions the user left on.
		install: (granted: PermissionKey[]) =>
			run('installing', async () => {
				if (!previewed) throw new Error('Review the app before installing it');
				await installApp(deps, { ...previewed, granted });
				session.preview = null;
				previewed = null;
			}),

		dismissPreview(): void {
			session.preview = null;
			previewed = null;
			session.error = null;
			events.stateChanged();
		},

		uninstall: forApp((id) => uninstallApp(deps, id)),
		approveUpdate: forApp((id) => approvePendingUpdate(deps, id)),
		rejectUpdate: forApp((id) => rejectPendingUpdate(deps, id)),

		setEnabled: (appId: string, enabled: boolean) =>
			run('working', () => setAppEnabled(deps, appId, enabled)),

		setAutoUpdate: (appId: string, autoUpdate: boolean) =>
			run('working', () => setAppAutoUpdate(deps, appId, autoUpdate)),

		setPermission: (appId: string, permission: PermissionKey, granted: boolean) =>
			run('working', () => setAppPermission(deps, appId, permission, granted)),

		clearCache: (appId: string) =>
			run('working', async () => {
				const userId = await activeUserId();
				if (!userId) throw new Error('No profile is active');
				await clearAppCache(deps, appId, userId);
			}),

		clearStorage: (appId: string) =>
			run('working', async () => {
				const userId = await activeUserId();
				if (!userId) throw new Error('No profile is active');
				await clearAppStorage(deps, appId, userId);
			}),

		checkUpdates: () =>
			run('checking', async () => {
				const outcomes = await checkAllForUpdates(deps);
				const byOutcome = (outcome: UpdateOutcome) =>
					Object.entries(outcomes)
						.filter(([, o]) => o === outcome)
						.map(([appId]) => appId);
				session.lastCheckSummary = {
					checkedAt: new Date().toISOString(),
					applied: byOutcome('applied'),
					pending: byOutcome('pending'),
					failed: byOutcome('failed')
				};
			})
	};
}
