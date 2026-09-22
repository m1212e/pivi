// A generic "push this URL to the paired phone" capability — not tied to
// YouTube or any one plugin. Reuses the exact mechanism plugins/runtime.ts
// already uses for a PhoneAuthHandoff (relay.ts's sendToPhones +
// remoteProtocol.ts's openUrlNotification), just exposed here so any page
// can trigger it on demand (e.g. a "visit this on your phone" button next
// to a device code), rather than only firing automatically.
import { schemaBuilder } from '../rumble';
import { openUrlNotification } from '#lib/pairing/remoteProtocol';
import { sendToPhones } from '../ws/relay';

schemaBuilder.mutationFields((t) => ({
	openUrlOnPhone: t.field({
		type: 'Boolean',
		args: { url: t.arg.string({ required: true }) },
		resolve: (_root, args) => {
			sendToPhones({
				jsonrpc: '2.0',
				method: openUrlNotification.method,
				params: { url: args.url }
			});
			return true;
		}
	})
}));
