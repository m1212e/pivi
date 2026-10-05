// What to show for the device's current connection, shared between the
// /wifi page's own top-right status badge and WifiManagerPanel's connecting
// state, so both agree on the exact same wording and pictogram.
import { Cable, RadioTower, Wifi, WifiOff, type LucideIcon } from '@lucide/svelte';
import * as m from '#lib/paraglide/messages';
import type { WifiManagementState } from './management';

export function wifiStatusLabel(wifi: WifiManagementState): string {
	if (wifi.connectingSsid) return m.wifi_connecting_to({ ssid: wifi.connectingSsid });
	if (wifi.ethernet) return m.wifi_on_ethernet();
	if (wifi.mode === 'client' && wifi.ssid) return m.wifi_current_network({ ssid: wifi.ssid });
	if (wifi.mode === 'hotspot') return m.wifi_on_hotspot();
	return m.wifi_offline();
}

export function wifiStatusIcon(wifi: WifiManagementState): LucideIcon {
	if (wifi.ethernet) return Cable;
	if (wifi.mode === 'hotspot') return RadioTower;
	if (wifi.mode === 'client' && wifi.ssid) return Wifi;
	return WifiOff;
}
