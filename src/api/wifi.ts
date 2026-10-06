// The OS side of wifi provisioning, a thin typed wrapper over `nmcli`. Used by
// the /wifi screen's service (wifiManagementService.ts), the network status
// query (handlers/network.ts) and the boot time AP (wifiBootstrap.ts).
//
// NetworkManager rather than wpa_supplicant because it also handles the AP,
// its DHCP and DNS, and persisting credentials. The CLI rather than D-Bus
// because every action here is coarse and nmcli's terse output is a stable
// contract that needs no extra dependency.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The Nix package pins this (see nix/module.nix), a development machine falls
// back to whatever is on PATH.
const NMCLI = process.env.PIVI_NMCLI || 'nmcli';

// Which radio to drive. NetworkManager can usually work this out itself, but
// the AP-mode calls need it named explicitly, and a Pi with a USB dongle
// plugged in has more than one.
const WIFI_INTERFACE = process.env.PIVI_WIFI_INTERFACE || undefined;

// A single, stable connection profile name, so repeated hotspot starts reuse
// one profile instead of leaving a pile of `Hotspot`, `Hotspot 1`, … behind.
const HOTSPOT_CONNECTION = 'pivi-hotspot';

const HOTSPOT_SSID = process.env.PIVI_HOTSPOT_SSID || 'pivi-setup';
// WPA2 requires 8 characters minimum. Deliberately not a secret, it is shown
// on the TV screen, and its only job is to keep the AP from being open (an
// open AP makes some phones refuse to auto-join, and invites neighbours onto
// the provisioning portal).
const HOTSPOT_PASSWORD = process.env.PIVI_HOTSPOT_PASSWORD || 'pivi-setup';

/** Lets the /wifi screen show which networks need a password. */
export type WifiSecurity = 'open' | 'wep' | 'wpa' | 'enterprise';

/** One row of the /wifi screen's network list. */
export type WifiNetwork = {
	ssid: string;
	/** 0..100, as NetworkManager reports it. */
	signal: number;
	security: WifiSecurity;
	/** Whether NetworkManager already has a saved profile for this SSID. */
	saved: boolean;
};

/** What the TV shows about its connection and what wifiBootstrap.ts decides on. */
export type NetworkState = {
	/**
	 * What the device is doing with its radio right now. `hotspot` means it is
	 * serving the provisioning AP, so it is not on a real network. `client`
	 * means it has joined one.
	 */
	mode: 'client' | 'hotspot' | 'disconnected';
	/** The joined network's SSID in `client` mode, else null. */
	ssid: string | null;
	/**
	 * Whether the device has a usable route to the internet, from
	 * NetworkManager's own connectivity check. Note this is independent of
	 * `mode`: ethernet alone gives connectivity with the radio disconnected.
	 */
	online: boolean;
	/** Whether a wired connection is up, the reason wifi may not be needed. */
	ethernet: boolean;
	hotspotSsid: string;
	hotspotPassword: string;
};

// nmcli's terse output escapes its own field separator and backslashes, which
// matters because an SSID is free-form text and may legitimately contain a
// colon. A colon only separates when every character before it is a whole
// token, so an escaped one never counts.
const UNESCAPED_COLON = /(?<=^(?:[^\\]|\\.)*):/;

function splitTerse(line: string): string[] {
	return line.split(UNESCAPED_COLON).map((field) => field.replace(/\\([\s\S]?)/g, '$1'));
}

async function nmcli(...args: string[]): Promise<string> {
	const { stdout } = await run(NMCLI, ['-t', ...args], {
		// Scans and joins take seconds, but a wedged NetworkManager should
		// surface as an error rather than a request that never answers.
		timeout: 45_000,
		maxBuffer: 4 * 1024 * 1024
	});
	return stdout;
}

function interfaceArgs(): string[] {
	return WIFI_INTERFACE ? ['ifname', WIFI_INTERFACE] : [];
}

function nonEmptyLines(stdout: string): string[] {
	return stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

// NetworkManager reports security as a space-separated set of flags
// ("WPA2 802.1X", "WPA1 WPA2", "" for an open network).
function parseSecurity(flags: string): WifiSecurity {
	if (flags.includes('802.1X')) return 'enterprise';
	if (flags.includes('WPA')) return 'wpa';
	if (flags.includes('WEP')) return 'wep';
	return 'open';
}

type WifiDevice = { device: string; state: string; connection: string };

// Only the configured interface if there is one, since a Pi with a USB
// dongle has two radios and provisioning must not wander between them.
function isTargetWifi(device: string, type: string): boolean {
	return type === 'wifi' && (!WIFI_INTERFACE || device === WIFI_INTERFACE);
}

async function wifiDevice(): Promise<WifiDevice | null> {
	const stdout = await nmcli('-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status');
	for (const line of nonEmptyLines(stdout)) {
		const [device, type, state, connection] = splitTerse(line);
		if (isTargetWifi(device, type)) return { device, state, connection };
	}
	return null;
}

async function ethernetConnected(): Promise<boolean> {
	const stdout = await nmcli('-f', 'TYPE,STATE', 'device', 'status');
	return nonEmptyLines(stdout).some((line) => {
		const [type, state] = splitTerse(line);
		return type === 'ethernet' && state === 'connected';
	});
}

async function isOnline(): Promise<boolean> {
	// Only `full` means a working route to the internet. `portal` and
	// `limited` count as offline.
	const stdout = await nmcli('networking', 'connectivity');
	return stdout.trim() === 'full';
}

async function savedSsids(): Promise<Set<string>> {
	const stdout = await nmcli('-f', 'NAME,TYPE', 'connection', 'show');
	const names = nonEmptyLines(stdout)
		.map((line) => splitTerse(line))
		.filter(([name, type]) => type === '802-11-wireless' && name !== HOTSPOT_CONNECTION)
		.map(([name]) => name);
	return new Set(names);
}

// Serving the setup AP counts as its own mode rather than as being connected:
// the radio is busy and associated, but there is no network behind it.
function deriveMode(device: WifiDevice | null): NetworkState['mode'] {
	if (!device) return 'disconnected';
	if (device.connection === HOTSPOT_CONNECTION) return 'hotspot';
	return device.state === 'connected' ? 'client' : 'disconnected';
}

// NetworkManager names a connection profile after the SSID it joins, which is
// what makes this readable straight off the device.
function joinedSsid(device: WifiDevice | null, mode: NetworkState['mode']): string | null {
	return mode === 'client' ? (device?.connection ?? null) : null;
}

/** Backs the TV's network status and the boot time AP decision. Throws if nmcli fails. */
export async function getNetworkState(): Promise<NetworkState> {
	const [device, ethernet, online] = await Promise.all([
		wifiDevice(),
		ethernetConnected(),
		isOnline()
	]);
	const mode = deriveMode(device);

	return {
		mode,
		ssid: joinedSsid(device, mode),
		online,
		ethernet,
		hotspotSsid: HOTSPOT_SSID,
		hotspotPassword: HOTSPOT_PASSWORD
	};
}

// `null` for a hidden network, which reports an empty SSID: there is nothing
// for a phone to tap, and joining one needs the name typed in by hand anyway.
function parseNetwork(line: string, saved: Set<string>): WifiNetwork | null {
	const [ssid, signal, security] = splitTerse(line);
	if (!ssid) return null;
	return {
		ssid,
		signal: Number(signal) || 0,
		security: parseSecurity(security ?? ''),
		saved: saved.has(ssid)
	};
}

// One entry per SSID, strongest signal wins: a mesh or a repeater shows the
// same network once per radio, which is noise in a list whose only job is
// letting someone pick their own network by name.
function strongestPerSsid(networks: WifiNetwork[]): WifiNetwork[] {
	const best = new Map<string, WifiNetwork>();
	for (const network of networks) {
		const existing = best.get(network.ssid);
		if (!existing || network.signal > existing.signal) best.set(network.ssid, network);
	}
	return [...best.values()].sort((a, b) => b.signal - a.signal);
}

/** Fills the /wifi screen's network list. One entry per SSID, strongest first. */
export async function scanNetworks(): Promise<WifiNetwork[]> {
	// `--rescan yes` forces a fresh scan rather than serving NetworkManager's
	// cached list, which on a device that just booted is often empty.
	const [stdout, saved] = await Promise.all([
		nmcli('-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'),
		savedSsids()
	]);

	const parsed = nonEmptyLines(stdout)
		.map((line) => parseNetwork(line, saved))
		.filter((network): network is WifiNetwork => network !== null);

	return strongestPerSsid(parsed);
}

/**
 * Raise the provisioning AP so a phone can reach the TV with no network. Reuses
 * one named profile, so calling it repeatedly is safe.
 */
export async function startHotspot(): Promise<void> {
	await nmcli(
		'device',
		'wifi',
		'hotspot',
		...interfaceArgs(),
		'con-name',
		HOTSPOT_CONNECTION,
		'ssid',
		HOTSPOT_SSID,
		'password',
		HOTSPOT_PASSWORD
	);
}

async function stopHotspot(): Promise<void> {
	try {
		await nmcli('connection', 'down', HOTSPOT_CONNECTION);
	} catch {
		// Already down, or never created, both mean the caller's intent is
		// already satisfied.
	}
}

/** A failed join is an expected outcome the /wifi screen shows, not an exception. */
export type ConnectResult = { ok: true } | { ok: false; error: string };

/**
 * Joins the network picked on the /wifi screen. The hotspot has to come down
 * first since the Pi's `brcmfmac` radio can't reliably be an AP and a station
 * at once.
 */
export async function connectToNetwork(
	ssid: string,
	password: string,
	hidden = false
): Promise<ConnectResult> {
	await stopHotspot();

	try {
		await nmcli(
			'device',
			'wifi',
			'connect',
			ssid,
			...(password ? ['password', password] : []),
			...(hidden ? ['hidden', 'yes'] : []),
			...interfaceArgs()
		);
		return { ok: true };
	} catch (error) {
		// nmcli puts the useful part ("Secrets were required, but not provided")
		// on stderr, which the thrown Error carries.
		return { ok: false, error: nmcliError(error) };
	}
}

// execFile rejects with an Error carrying the child's stderr, anything else
// is an ordinary failure with nothing extra to report.
function stderrOf(error: unknown): string {
	if (!error || typeof error !== 'object' || !('stderr' in error)) return '';
	return String((error as { stderr: unknown }).stderr).trim();
}

function nmcliError(error: unknown): string {
	return stderrOf(error) || (error instanceof Error ? error.message : String(error));
}

/**
 * Lets callers skip wifi on dev machines and wired only boxes instead of
 * crashing. Needs both NetworkManager and a radio, since a desktop runs
 * NetworkManager fine without wifi hardware.
 */
export async function isAvailable(): Promise<boolean> {
	try {
		await nmcli('--version');
		return (await wifiDevice()) !== null;
	} catch {
		return false;
	}
}
