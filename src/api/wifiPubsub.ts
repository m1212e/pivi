// Lets the /wifi screen's subscription (handlers/wifi.ts) get pushed every
// state change instead of polling. Published by wifiManagement.ts.
import { createPubSub } from 'graphql-yoga';

export const WIFI_MANAGEMENT_EVENT = 'wifi:management';

export const wifiPubSub = createPubSub<Record<string, []>>();
