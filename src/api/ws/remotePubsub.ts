// Pushes "a phone connected or disconnected" from the relay (relay.ts) to the
// `phoneConnected` subscription in handlers/remote.ts, so the TV can react
// without polling.
import { createPubSub } from 'graphql-yoga';

export const PHONE_CONNECTION_EVENT = 'remote:phoneConnection';

// On globalThis since relay.ts's server survives dev HMR and must keep
// publishing to the same instance the subscriptions listen on.
declare global {
	var __piviRemotePubSub: ReturnType<typeof createPubSub<Record<string, []>>> | undefined;
}

export const remotePubSub = (globalThis.__piviRemotePubSub ??= createPubSub<Record<string, []>>());
