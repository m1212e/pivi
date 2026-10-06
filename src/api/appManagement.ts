// The app management service wired to the real database, registry and sandbox.
// The service itself takes its deps as arguments so it can be tested, this is
// the single live instance handlers/appManagement.ts serves to the /apps screen.
import { getActiveProfileUser } from './activeProfile';
import { createAppManagement } from './appManagementService';
import { defaultAppDeps } from './apps/deps';
import { announceAppListChanged, APP_MANAGEMENT_EVENT } from './apps/events';
import { appPubSub } from './apps/pubsub';

export const appManagement = createAppManagement(
	defaultAppDeps,
	{
		stateChanged: () => appPubSub.publish(APP_MANAGEMENT_EVENT),
		listChanged: announceAppListChanged
	},
	async () => (await getActiveProfileUser())?.id ?? null
);
