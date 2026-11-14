// Joins a Wi-Fi network through NetworkManager's D-Bus API, so the password
// travels over the bus instead of appearing in a process's argument list
// (`nmcli ... password hunter2` is readable by every local user in /proc).
// Everything else in wifi.ts stays on nmcli. wifi.ts falls back to nmcli when
// anything here throws, so a quirk of this path can't leave a device unable to
// join a network.
import dbus, { Variant } from 'dbus-next';

const NM = 'org.freedesktop.NetworkManager';
const NM_PATH = '/org/freedesktop/NetworkManager';
const PROPS = 'org.freedesktop.DBus.Properties';

const DEVICE_TYPE_WIFI = 2;
const ACTIVE_ACTIVATED = 2;
const ACTIVE_DEACTIVATED = 4;
// NM_802_11_AP_SEC_KEY_MGMT_PSK / _SAE
const KEY_MGMT_PSK = 0x100;
const KEY_MGMT_SAE = 0x400;

const ACTIVATION_TIMEOUT_MS = 45_000;

type Bus = dbus.MessageBus;

async function iface(bus: Bus, path: string, name: string) {
	const object = await bus.getProxyObject(NM, path);
	return object.getInterface(name);
}

async function property<T>(bus: Bus, path: string, name: string, prop: string): Promise<T> {
	const props = await iface(bus, path, PROPS);
	const value = (await props.Get(name, prop)) as Variant<T>;
	return value.value;
}

async function findWifiDevice(bus: Bus, ifname: string | undefined): Promise<string> {
	const manager = await iface(bus, NM_PATH, NM);
	if (ifname) return (await manager.GetDeviceByIpIface(ifname)) as string;
	for (const path of (await manager.GetDevices()) as string[]) {
		const type = await property<number>(bus, path, `${NM}.Device`, 'DeviceType');
		if (type === DEVICE_TYPE_WIFI) return path;
	}
	throw new Error('No Wi-Fi device');
}

// WPA3 personal networks (SAE only) reject a WPA2 PSK profile, so the
// access point's advertised key management decides which to ask for.
async function keyManagement(bus: Bus, device: string, ssid: string): Promise<'wpa-psk' | 'sae'> {
	const wireless = await iface(bus, device, `${NM}.Device.Wireless`);
	for (const path of (await wireless.GetAllAccessPoints()) as string[]) {
		const raw = await property<number[]>(bus, path, `${NM}.AccessPoint`, 'Ssid');
		if (Buffer.from(raw).toString('utf8') !== ssid) continue;
		const rsn = await property<number>(bus, path, `${NM}.AccessPoint`, 'RsnFlags');
		if (rsn & KEY_MGMT_SAE && !(rsn & KEY_MGMT_PSK)) return 'sae';
		break;
	}
	return 'wpa-psk';
}

type Settings = Record<string, Record<string, Variant>>;

function buildSettings(ssid: string, hidden: boolean, secret?: { keyMgmt: string; psk: string }) {
	const settings: Settings = {
		connection: { id: new Variant('s', ssid), type: new Variant('s', '802-11-wireless') },
		'802-11-wireless': {
			ssid: new Variant('ay', Buffer.from(ssid, 'utf8')),
			mode: new Variant('s', 'infrastructure'),
			hidden: new Variant('b', hidden)
		}
	};
	if (secret) {
		settings['802-11-wireless-security'] = {
			'key-mgmt': new Variant('s', secret.keyMgmt),
			psk: new Variant('s', secret.psk)
		};
	}
	return settings;
}

// Resolves once the activation settles, with NetworkManager's reason code when
// it failed. Subscribes before returning control, so a fast result isn't missed.
async function waitForActivation(bus: Bus, active: string): Promise<void> {
	const object = await bus.getProxyObject(NM, active);
	const connection = object.getInterface(`${NM}.Connection.Active`);
	const state = (await property<number>(bus, active, `${NM}.Connection.Active`, 'State')) ?? 0;
	if (state === ACTIVE_ACTIVATED) return;

	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => done(new Error('Timed out connecting')), ACTIVATION_TIMEOUT_MS);
		const onChange = (next: number, reason: number) => {
			if (next === ACTIVE_ACTIVATED) done();
			else if (next === ACTIVE_DEACTIVATED) done(new Error(`Connection failed (reason ${reason})`));
		};
		function done(error?: Error) {
			clearTimeout(timer);
			connection.off('StateChanged', onChange);
			if (error) reject(error);
			else resolve();
		}
		connection.on('StateChanged', onChange);
	});
}

/**
 * Throws on any failure, including a rejected password, so the caller can fall
 * back to nmcli and surface nmcli's own, better worded message.
 */
export async function connectViaDbus(
	ssid: string,
	password: string,
	hidden: boolean,
	ifname: string | undefined
): Promise<void> {
	const bus = dbus.systemBus();
	try {
		const device = await findWifiDevice(bus, ifname);
		const keyMgmt = password ? await keyManagement(bus, device, ssid) : undefined;
		const settings = buildSettings(
			ssid,
			hidden,
			password && keyMgmt ? { keyMgmt, psk: password } : undefined
		);

		const manager = await iface(bus, NM_PATH, NM);
		const [, active] = (await manager.AddAndActivateConnection(settings, device, '/')) as [
			string,
			string
		];
		await waitForActivation(bus, active);
	} finally {
		bus.disconnect();
	}
}
