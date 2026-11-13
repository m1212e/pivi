import { networkInterfaces } from 'node:os';
import { QR_BIND_HOSTNAME, QR_BIND_IP } from '$app/env/private';
import { isIP } from 'node:net';
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

function detectLanAddress(): string | null {
	const interfaces = Object.values(networkInterfaces()).flat();
	return interfaces.find((iface) => iface && isLanInterface(iface))?.address ?? null;
}
