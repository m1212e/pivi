import { networkInterfaces } from 'node:os';
import { QR_BIND_HOSTNAME, QR_BIND_IP } from '$app/env/private';
import { isIP } from 'node:net';
// The TV's kiosk browser usually points at localhost, but a phone scanning
// the pairing QR code needs a LAN-reachable address instead.

function isLanInterface(iface: { family: string; internal: boolean }): boolean {
	return iface.family === 'IPv4' && !iface.internal;
}

export function getLanAddressOrHostname() {
	if (QR_BIND_HOSTNAME) {
		return QR_BIND_HOSTNAME;
	}
	if (QR_BIND_IP) {
		const version = isIP(QR_BIND_IP);
		if (version === 6) return `[${QR_BIND_IP}]`;
		if (version === 4) return QR_BIND_IP;
		return null;
	}
	const interfaces = Object.values(networkInterfaces()).flat();
	return interfaces.find((iface) => iface && isLanInterface(iface))?.address ?? null;
}
