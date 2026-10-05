// A generic "push this URL to the paired phone" capability — not tied to
// YouTube or any one app. An app builds whatever it needs (a sign-in code,
// a login link) out of its own screen content and wires one button to this
// (see dashboard.ts's `openOnPhone` action and UiNodeRenderer.svelte), or a
// page triggers it directly (e.g. "Open on your phone" next to a device
// code) — either way it's just relay.ts's sendToPhones +
// remoteProtocol.ts's openUrlNotification.
import { GraphQLError } from 'graphql';
import { schemaBuilder } from '../rumble';
import { openUrlNotification } from '#lib/pairing/remoteProtocol';
import { hasConnectedPhone, sendToPhones } from '../ws/relay';
import { PHONE_CONNECTION_EVENT, remotePubSub } from '../ws/remotePubsub';

type PhoneConnection = { connected: boolean };

// Wrapped in an object rather than exposed as a raw top-level scalar field —
// see the comment on `Pairing` in handlers/pairing.ts: a scalar top-level
// query field resolves to a `Subscribeable` wrapper on the generated client,
// an object-shaped one resolves directly to usable data.
const PhoneConnectionRef = schemaBuilder.objectRef<PhoneConnection>('PhoneConnection').implement({
	fields: (t) => ({ connected: t.exposeBoolean('connected') })
});

function resolvePhoneConnection(): PhoneConnection {
	return { connected: hasConnectedPhone() };
}

schemaBuilder.queryFields((t) => ({
	// Whether a paired phone is connected right now -- lets the TV's own UI
	// (the pairing QR overlay, see PairingOverlay.svelte) show "scan to
	// connect" only while that's actually true, instead of unconditionally.
	phoneConnection: t.field({ type: PhoneConnectionRef, resolve: resolvePhoneConnection })
}));

schemaBuilder.subscriptionFields((t) => ({
	phoneConnection: t.field({
		type: PhoneConnectionRef,
		subscribe: () => remotePubSub.subscribe(PHONE_CONNECTION_EVENT),
		resolve: resolvePhoneConnection
	})
}));

schemaBuilder.mutationFields((t) => ({
	openUrlOnPhone: t.field({
		type: 'Boolean',
		args: { url: t.arg.string({ required: true }) },
		resolve: (_root, args) => {
			// sendToPhones silently does nothing if none is connected, which looked
			// like a dead button -- this is the only thing that distinguishes "it
			// worked" from "there was nobody to tell" for the caller.
			if (!hasConnectedPhone()) {
				throw new GraphQLError('Pair a phone first to open this link there');
			}
			sendToPhones({
				jsonrpc: '2.0',
				method: openUrlNotification.method,
				params: { url: args.url }
			});
			return true;
		}
	})
}));
