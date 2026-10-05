// Everything the install/update logic reaches outside itself for, gathered so a
// test can hand in fakes and the real wiring lives in one place.
import { processControl } from './manager';
import { RegistryClient } from './registry';
import { verifyImageSignature } from './signature';
import { microsandboxBackend } from './sandbox/microsandbox';
import type { SandboxBackend } from './sandbox/types';
import { dbAppStore, type AppStore } from './store';

// How the install logic affects apps that are running right now.
export interface AppProcessControl {
	isRunning(appId: string): boolean;
	// Stops it (and forgets any caches of what it produced); it starts again on
	// next use.
	stop(appId: string): Promise<void>;
	// Stops it and starts it again right away, rejecting if it can't start.
	restart(appId: string): Promise<void>;
}

export type AppDeps = {
	store: AppStore;
	registry: RegistryClient;
	backend: SandboxBackend;
	verify: typeof verifyImageSignature;
	control: AppProcessControl;
};

export const defaultAppDeps: AppDeps = {
	store: dbAppStore,
	registry: new RegistryClient(),
	backend: microsandboxBackend,
	verify: verifyImageSignature,
	control: processControl
};
