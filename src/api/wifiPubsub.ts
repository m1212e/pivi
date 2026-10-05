// Real push-based updates for the wifi-management GraphQL field, instead of
// the frontend polling on a setInterval -- same idea as apps/pubsub.ts,
// just for the one event this needs.
import { createPubSub } from 'graphql-yoga';

export const WIFI_MANAGEMENT_EVENT = 'wifi:management';

export const wifiPubSub = createPubSub<Record<string, []>>();
