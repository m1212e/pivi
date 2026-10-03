// Everything the install/update logic reaches outside itself for, gathered so a
// test can hand in fakes and the real wiring lives in one place.
import { processControl } from './manager';
import { RegistryClient } from './registry';
import { verifyImageSignature } from './signature';
import { microsandboxBackend } from './sandbox/microsandbox';
import type { SandboxBackend } from './sandbox/types';
import { dbPluginStore, type PluginStore } from './store';

// How the install logic affects plugins that are running right now.
export interface PluginProcessControl {
	isRunning(pluginId: string): boolean;
	// Stops it (and forgets any caches of what it produced); it starts again on
	// next use.
	stop(pluginId: string): Promise<void>;
	// Stops it and starts it again right away, rejecting if it can't start.
	restart(pluginId: string): Promise<void>;
}

export type PluginDeps = {
	store: PluginStore;
	registry: RegistryClient;
	backend: SandboxBackend;
	verify: typeof verifyImageSignature;
	control: PluginProcessControl;
};

export const defaultPluginDeps: PluginDeps = {
	store: dbPluginStore,
	registry: new RegistryClient(),
	backend: microsandboxBackend,
	verify: verifyImageSignature,
	control: processControl
};
