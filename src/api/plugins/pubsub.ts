// Real push-based updates for plugin-sourced GraphQL fields (dashboard,
// screen, auth) instead of the frontend polling on a setInterval. These
// fields aren't backed by a DB table, so rumble's own table-bound
// `pubsub({table: ...})` helper doesn't apply — this is the same
// `createPubSub` primitive graphql-yoga (and rumble internally) uses, just
// for events the plugin host publishes itself whenever a plugin's state
// actually changes (see runtime.ts's loadPlugin `onUpdate` callback and
// manager.ts, which wires it to this).
//
// Loosely typed (any string key, no payload) rather than a fixed map of
// event names: keys are built at runtime as `${pluginId}:${kind}` (and
// `${pluginId}:screen:${screenId}` for screens), since the actual set of
// plugins/screens isn't known statically here.
import { createPubSub } from 'graphql-yoga';

export const pluginPubSub = createPubSub<Record<string, []>>();
