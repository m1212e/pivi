// Real push-based updates for app-sourced GraphQL fields (dashboard,
// screen, auth) instead of the frontend polling on a setInterval. These
// fields aren't backed by a DB table, so rumble's own table-bound
// `pubsub({table: ...})` helper doesn't apply — this is the same
// `createPubSub` primitive graphql-yoga (and rumble internally) uses, just
// for events the app host publishes itself whenever an app's state
// actually changes (see runtime.ts's loadApp `onUpdate` callback and
// manager.ts, which wires it to this).
//
// Loosely typed (any string key, no payload) rather than a fixed map of
// event names: keys are built at runtime as `${appId}:${kind}` (and
// `${appId}:screen:${screenId}` for screens), since the actual set of
// apps/screens isn't known statically here.
import { createPubSub } from 'graphql-yoga';

export const appPubSub = createPubSub<Record<string, []>>();
