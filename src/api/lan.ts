import { networkInterfaces } from 'node:os';

// The TV's kiosk browser usually points at localhost, but a phone scanning
// the pairing QR code needs a LAN-reachable address instead.
function isLanInterface(iface: { family: string; internal: boolean }): boolean {
	return iface.family === 'IPv4' && !iface.internal;
}

export function getLanAddress() {
	const interfaces = Object.values(networkInterfaces()).flat();
	return interfaces.find((iface) => iface && isLanInterface(iface))?.address ?? null;
}
