// The single live wifi management service that handlers/wifi.ts serves to the
// /wifi screen. The service takes its event hooks as arguments so it can be tested.
import { createWifiManagement } from './wifiManagementService';
import { WIFI_MANAGEMENT_EVENT, wifiPubSub } from './wifiPubsub';

export const wifiManagement = createWifiManagement({
	stateChanged: () => wifiPubSub.publish(WIFI_MANAGEMENT_EVENT)
});
