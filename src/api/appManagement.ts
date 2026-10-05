// The app management service wired to the real database, registry and sandbox
// (see appManagementService.ts for what it does and who may ask).
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
