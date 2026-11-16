import { describe, expect, it, vi } from 'vitest';
import type { NetworkState } from './wifi';

// The module wires itself to the live NetworkManager helpers; only
// createProvisioner is under test, so they are stubbed out.
vi.mock('./wifi', () => ({
	isAvailable: vi.fn(),
	getNetworkState: vi.fn(),
	startHotspot: vi.fn(),
	stopHotspot: vi.fn()
}));
vi.mock('./wifiManagement', () => ({ wifiManagement: { joining: () => false } }));

const { createProvisioner } = await import('./wifiBootstrap');

type State = Pick<NetworkState, 'mode' | 'online' | 'ethernet'>;

function setup(initial: State) {
	let network = initial;
	let joining = false;
	const startHotspot = vi.fn(async () => {});
	const stopHotspot = vi.fn(async () => {});
	const provisioner = createProvisioner({
		isAvailable: () => Promise.resolve(true),
		getNetworkState: () => Promise.resolve(network),
		startHotspot,
		stopHotspot,
		joining: () => joining
	});
	return {
		provisioner,
		startHotspot,
		stopHotspot,
		set: (next: State) => (network = next),
		setJoining: (value: boolean) => (joining = value)
	};
}

const offline: State = { mode: 'disconnected', online: false, ethernet: false };

describe('the setup access point', () => {
	it('keeps trying while the device is offline, and reports why it failed', async () => {
		const { provisioner, startHotspot } = setup(offline);
		startHotspot.mockRejectedValueOnce(new Error('No suitable device found'));
		await provisioner.check();
		expect(provisioner.lastError()).toBe('No suitable device found');
		await provisioner.check();
		expect(startHotspot).toHaveBeenCalledTimes(2);
		expect(provisioner.lastError()).toBeNull();
	});

	it('restarts an AP left over from the last boot once, then leaves it up', async () => {
		const { provisioner, startHotspot } = setup({ ...offline, mode: 'hotspot' });
		await provisioner.check();
		await provisioner.check();
		expect(startHotspot).toHaveBeenCalledTimes(1);
	});

	it('stays out of the way while a join from /wifi is running', async () => {
		const { provisioner, startHotspot, setJoining } = setup(offline);
		setJoining(true);
		await provisioner.check();
		expect(startHotspot).not.toHaveBeenCalled();
	});

	it('does nothing on ethernet or on a joined network, and forgets old errors', async () => {
		const { provisioner, startHotspot, set } = setup(offline);
		startHotspot.mockRejectedValueOnce(new Error('boom'));
		await provisioner.check();
		set({ mode: 'client', online: true, ethernet: false });
		await provisioner.check();
		set({ mode: 'disconnected', online: false, ethernet: true });
		await provisioner.check();
		expect(startHotspot).toHaveBeenCalledTimes(1);
		expect(provisioner.lastError()).toBeNull();
	});

	it('takes the AP down once a cable is plugged in, and back up when it is pulled', async () => {
		const { provisioner, startHotspot, stopHotspot, set } = setup(offline);
		await provisioner.check();
		set({ mode: 'hotspot', online: false, ethernet: true });
		await provisioner.check();
		expect(stopHotspot).toHaveBeenCalledTimes(1);
		set(offline);
		await provisioner.check();
		expect(startHotspot).toHaveBeenCalledTimes(2);
	});
});
