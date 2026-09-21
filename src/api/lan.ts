import { networkInterfaces } from 'node:os';

// The TV's kiosk browser usually points at localhost, but a phone scanning
// the pairing QR code needs a LAN-reachable address instead.
export function getLanAddress() {
	for (const ifaces of Object.values(networkInterfaces())) {
		for (const iface of ifaces ?? []) {
			if (iface.family === 'IPv4' && !iface.internal) return iface.address;
		}
	}
	return null;
}
