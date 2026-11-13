// What the TV knows about the paired phone: whether one is connected (for
// PairingOverlay.svelte) and a generic "open this URL on the phone" mutation,
// which app UIs wire to a button through UiNodeRenderer.svelte, e.g. for a
// sign in link.
import { GraphQLError } from 'graphql';
import { schemaBuilder } from '../rumble';
import { openUrlNotification } from '#lib/pairing/remoteProtocol';
import { hasConnectedPhone, sendToPhones } from '../ws/relay';
import { isPhoneSafeUrl } from '../apps/sanitize';
import { PHONE_CONNECTION_EVENT, remotePubSub } from '../ws/remotePubsub';

type PhoneConnection = { connected: boolean };

// An object rather than a scalar field so the generated client resolves it
// to plain data, see handlers/pairing.ts.
const PhoneConnectionRef = schemaBuilder.objectRef<PhoneConnection>('PhoneConnection').implement({
	fields: (t) => ({ connected: t.exposeBoolean('connected') })
});

function resolvePhoneConnection(): PhoneConnection {
	return { connected: hasConnectedPhone() };
}

schemaBuilder.queryFields((t) => ({
	// Lets PairingOverlay.svelte show "scan to connect" only while no phone is
	// connected.
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
			// The URL comes from an app's screen by way of the TV, so it gets the
			// same https-only rule the screen's sanitizer applies.
			if (!isPhoneSafeUrl(args.url)) throw new GraphQLError('Only https links can be opened');
			// sendToPhones silently does nothing without a phone, which looked
			// like a dead button, so the caller gets an error instead.
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
