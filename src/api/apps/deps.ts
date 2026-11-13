// Everything the install/update logic reaches outside itself for, gathered so a
// test can hand in fakes and the real wiring lives in one place.
import { processControl } from './manager';
import { RegistryClient } from './registry';
import { verifyImageSignature } from './signature';
import { microsandboxBackend } from './sandbox/microsandbox';
import type { SandboxBackend } from './sandbox/types';
import { dbAppStore, type AppStore } from './store';

/**
 * How install and update logic stops or restarts running apps without
 * importing manager.ts, so tests can swap in a fake (processControl is the real one).
 */
export interface AppProcessControl {
	isRunning(appId: string): boolean;
	// Stops it (and forgets any caches of what it produced). It starts again
	// on next use.
	stop(appId: string): Promise<void>;
	// Stops it and starts it again right away, rejecting if it can't start.
	restart(appId: string): Promise<void>;
}

/**
 * Passed into installer.ts, updater.ts and updateAvailability.ts instead of
 * them importing the database, registry and sandbox directly, so tests can
 * replace single pieces.
 */
export type AppDeps = {
	store: AppStore;
	registry: RegistryClient;
	backend: SandboxBackend;
	verify: typeof verifyImageSignature;
	control: AppProcessControl;
};

/** The real wiring, used by app management, the home screen tiles and lifecycle.ts. */
export const defaultAppDeps: AppDeps = {
	store: dbAppStore,
	registry: new RegistryClient(),
	backend: microsandboxBackend,
	verify: verifyImageSignature,
	control: processControl
};
