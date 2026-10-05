// The wifi management service wired to the real wifi module (see
// wifiManagementService.ts for what it does and who may ask).
import { createWifiManagement } from './wifiManagementService';
import { WIFI_MANAGEMENT_EVENT, wifiPubSub } from './wifiPubsub';

export const wifiManagement = createWifiManagement({
	stateChanged: () => wifiPubSub.publish(WIFI_MANAGEMENT_EVENT)
});
