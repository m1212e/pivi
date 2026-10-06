// Pushes "a phone connected or disconnected" from the relay (relay.ts) to the
// `phoneConnected` subscription in handlers/remote.ts, so the TV can react
// without polling.
import { createPubSub } from 'graphql-yoga';

export const PHONE_CONNECTION_EVENT = 'remote:phoneConnection';

export const remotePubSub = createPubSub<Record<string, []>>();
