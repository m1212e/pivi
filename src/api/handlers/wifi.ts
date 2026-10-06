// Serves the TV's /wifi screen, so a network can be scanned for and joined
// with nothing but the remote (trackpad plus the phone's keyboard relay).
import { schemaBuilder } from '../rumble';
import type { WifiManagementState } from '#lib/wifi/management';
import { wifiManagement } from '../wifiManagement';
import { WIFI_MANAGEMENT_EVENT, wifiPubSub } from '../wifiPubsub';

type NetworkEntry = NonNullable<WifiManagementState['networks']>[number];

const WifiNetworkRef = schemaBuilder.objectRef<NetworkEntry>('WifiNetwork').implement({
	fields: (t) => ({
		ssid: t.exposeString('ssid'),
		signal: t.exposeInt('signal'),
		// 'open' | 'wep' | 'wpa' | 'enterprise', a string for the same reason
		// `mode` below is, see handlers/network.ts.
		security: t.exposeString('security'),
		saved: t.exposeBoolean('saved')
	})
});

const WifiManagementRef = schemaBuilder.objectRef<WifiManagementState>('WifiManagement').implement({
	fields: (t) => ({
		available: t.exposeBoolean('available'),
		mode: t.exposeString('mode'),
		ssid: t.exposeString('ssid', { nullable: true }),
		online: t.exposeBoolean('online'),
		ethernet: t.exposeBoolean('ethernet'),
		networks: t.field({ type: [WifiNetworkRef], nullable: true, resolve: (s) => s.networks }),
		scanning: t.exposeBoolean('scanning'),
		connectingSsid: t.exposeString('connectingSsid', { nullable: true }),
		// Not called `error`: the generated client throws any result object that has a
		// truthy `error` property (it checks for a failed request that way).
		errorMessage: t.string({ nullable: true, resolve: (s) => s.error })
	})
});

// Returns right away since a scan or join takes seconds. Progress and failures
// reach the screen through the subscription instead.
function start(work: () => Promise<void> | void): boolean {
	void Promise.resolve(work()).catch(() => {});
	return true;
}

schemaBuilder.queryFields((t) => ({
	wifiManagement: t.field({ type: WifiManagementRef, resolve: () => wifiManagement.state() })
}));

schemaBuilder.subscriptionFields((t) => ({
	wifiManagement: t.field({
		type: WifiManagementRef,
		subscribe: () => wifiPubSub.subscribe(WIFI_MANAGEMENT_EVENT),
		resolve: () => wifiManagement.state()
	})
}));

schemaBuilder.mutationFields((t) => ({
	scanWifiNetworks: t.field({
		type: 'Boolean',
		resolve: () => start(() => wifiManagement.scan())
	}),
	connectWifiNetwork: t.field({
		type: 'Boolean',
		args: {
			ssid: t.arg.string({ required: true }),
			password: t.arg.string(),
			hidden: t.arg.boolean()
		},
		resolve: (_root, args) =>
			start(() => wifiManagement.connect(args.ssid, args.password ?? '', args.hidden ?? false))
	})
}));
