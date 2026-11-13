// Read only network status that the pre login profile picker polls to decide
// whether to show NetworkSetup.svelte, so it works with no profile or paired
// phone yet. Scanning and joining live in handlers/wifi.ts.
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
// `pairing` is one, see the comment in handlers/pairing.ts.
const NetworkRef = schemaBuilder.objectRef<Network>('Network').implement({
	fields: (t) => ({
		available: t.exposeBoolean('available'),
		// 'client' | 'hotspot' | 'disconnected'. A string rather than an enum
		// that would need keeping in step with the wifi module's union.
		mode: t.exposeString('mode'),
		ssid: t.exposeString('ssid', { nullable: true }),
		online: t.exposeBoolean('online'),
		ethernet: t.exposeBoolean('ethernet'),
		// Shown on the TV and in a `WIFI:` QR code so a phone can join the AP.
		// Not a secret, it only keeps the AP from being open.
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
			// Asked regardless of `available`, since a wired only box still has a
			// real answer for ethernet and internet connectivity.
			const available = await isAvailable();
			try {
				return { ...(await getNetworkState()), available };
			} catch {
				// No NetworkManager is normal in development. Report online so the
				// TV doesn't show a setup prompt nobody can act on.
				return { ...UNAVAILABLE, online: true };
			}
		}
	})
}));
