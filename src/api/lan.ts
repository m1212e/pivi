import { networkInterfaces } from 'node:os';
import { QR_BIND_HOSTNAME, QR_BIND_IP } from '$app/env/private';
import { isIP } from 'node:net';
import { HOTSPOT_ADDRESS } from './wifi';
// The TV's kiosk browser usually points at localhost, but a phone scanning
// the pairing QR code needs a LAN-reachable address instead.

function isLanInterface(iface: { family: string; internal: boolean }): boolean {
	return iface.family === 'IPv4' && !iface.internal;
}

/**
 * hooks.server.ts builds the phone pairing URL from this. QR_BIND_HOSTNAME and
 * QR_BIND_IP override the detected address. Null without a usable one.
 */
export function getLanAddressOrHostname() {
	if (QR_BIND_HOSTNAME) {
		return QR_BIND_HOSTNAME;
	}
	if (QR_BIND_IP) {
		return urlHost(QR_BIND_IP);
	}
	return detectLanAddress();
}

/** Brackets an IPv6 address for use in a URL. Null when it isn't an IP at all. */
function urlHost(ip: string): string | null {
	const version = isIP(ip);
	if (version === 6) return `[${ip}]`;
	if (version === 4) return ip;
	return null;
}

// While the setup AP is up, the phones scanning the QR code are on it, and a
// wired address that happens to come first in the list is one they may not
// reach from there. The AP only runs while the device is offline
// (wifiBootstrap.ts), so this doesn't outlive the setup.
function detectLanAddress(): string | null {
	const addresses = Object.values(networkInterfaces())
		.flat()
		.flatMap((iface) => (iface && isLanInterface(iface) ? [iface.address] : []));
	if (addresses.includes(HOTSPOT_ADDRESS)) return HOTSPOT_ADDRESS;
	return addresses[0] ?? null;
}
