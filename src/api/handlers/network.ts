// The TV's own view of provisioning: enough to tell whether this device can
// reach the network, and if not, what to put on screen so a phone can join the
// provisioning access point.
//
// Read-only on purpose. Every operation that *changes* the network (scan, join)
// is driven by the paired phone over the relay instead (src/api/wifiCommands.ts)
// — the TV page is rendered from an unauthenticated local browser, and giving
// it a mutation that reconfigures the device's network would make that page the
// weakest link in the chain.
import { getNetworkState, isAvailable } from '../wifi';
import { schemaBuilder } from '../rumble';

type Network = {
	available: boolean;
	mode: string;
	ssid: string | null;
	online: boolean;
	ethernet: boolean;
	hotspotSsid: string;
	hotspotPassword: string;
};

// A nested object type rather than flat scalar fields, for the same reason
// `pairing` is one — see the comment in handlers/pairing.ts.
const NetworkRef = schemaBuilder.objectRef<Network>('Network').implement({
	fields: (t) => ({
		available: t.exposeBoolean('available'),
		// 'client' | 'hotspot' | 'disconnected' — a string rather than a GraphQL
		// enum because the only consumer switches on "is it the hotspot", and an
		// enum here would need keeping in lockstep with the wifi module's union
		// for no gain.
		mode: t.exposeString('mode'),
		ssid: t.exposeString('ssid', { nullable: true }),
		online: t.exposeBoolean('online'),
		ethernet: t.exposeBoolean('ethernet'),
		// Shown on the TV as text and encoded into a `WIFI:` QR code, so a phone
		// can join the provisioning AP by scanning rather than typing. Not a
		// secret: it exists to keep the AP from being open, and anyone who can
		// read it is already looking at the television.
		hotspotSsid: t.exposeString('hotspotSsid'),
		hotspotPassword: t.exposeString('hotspotPassword')
	})
});

const UNAVAILABLE: Network = {
	available: false,
	mode: 'disconnected',
	ssid: null,
	online: false,
	ethernet: false,
	hotspotSsid: '',
	hotspotPassword: ''
};

schemaBuilder.queryFields((t) => ({
	network: t.field({
		type: NetworkRef,
		resolve: async () => {
			// NetworkManager missing is the normal case in development. The TV
			// should carry on as if everything is fine rather than showing a
			// provisioning prompt nobody can act on, so this reports
			// `available: false` with `online: true`.
			if (!(await isAvailable())) return { ...UNAVAILABLE, online: true };
			try {
				// `available` isn't part of the wifi module's own state — it answers
				// "can this device manage wifi at all", which is settled by the check
				// above rather than by anything NetworkManager reports.
				return { ...(await getNetworkState()), available: true };
			} catch {
				return { ...UNAVAILABLE, online: true };
			}
		}
	})
}));
