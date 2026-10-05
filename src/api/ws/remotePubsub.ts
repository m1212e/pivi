// Real push-based updates for whether a phone is currently connected to the
// pairing relay -- same idea as apps/pubsub.ts's own createPubSub use, just
// for this one event. relay.ts publishes it whenever a phone finishes
// connecting or disconnects; handlers/remote.ts's `phoneConnected` field is
// the only reader.
import { createPubSub } from 'graphql-yoga';

export const PHONE_CONNECTION_EVENT = 'remote:phoneConnection';

export const remotePubSub = createPubSub<Record<string, []>>();
