import { describe, expect, it } from 'vitest';
import { Cable, RadioTower, Wifi, WifiOff } from '@lucide/svelte';
import type { WifiManagementState } from './management';
import { wifiStatusIcon, wifiStatusLabel } from './status';

function state(overrides: Partial<WifiManagementState> = {}): WifiManagementState {
	return {
		available: true,
		mode: 'disconnected',
		ssid: null,
		online: false,
		ethernet: false,
		networks: null,
		scanning: false,
		connectingSsid: null,
		error: null,
		...overrides
	};
}

describe('wifiStatusLabel', () => {
	it('prefers an in-flight join over everything else', () => {
		expect(wifiStatusLabel(state({ connectingSsid: 'Home', ethernet: true }))).toBe(
			'Connecting to Home…'
		);
	});

	it('prefers ethernet over the wifi mode', () => {
		expect(wifiStatusLabel(state({ ethernet: true, mode: 'client', ssid: 'Home' }))).toBe(
			'Connected by cable'
		);
	});

	it('names the joined network, the hotspot, or nothing', () => {
		expect(wifiStatusLabel(state({ mode: 'client', ssid: 'Home' }))).toBe('Connected to Home');
		expect(wifiStatusLabel(state({ mode: 'hotspot' }))).toBe('Serving the setup network');
		expect(wifiStatusLabel(state({ mode: 'client' }))).toBe('Not connected');
		expect(wifiStatusLabel(state())).toBe('Not connected');
	});
});

describe('wifiStatusIcon', () => {
	it('follows the same precedence as the label, minus the in-flight join', () => {
		expect(wifiStatusIcon(state({ ethernet: true, mode: 'hotspot' }))).toBe(Cable);
		expect(wifiStatusIcon(state({ mode: 'hotspot' }))).toBe(RadioTower);
		expect(wifiStatusIcon(state({ mode: 'client', ssid: 'Home' }))).toBe(Wifi);
		expect(wifiStatusIcon(state({ mode: 'client', connectingSsid: 'Home' }))).toBe(WifiOff);
	});
});
