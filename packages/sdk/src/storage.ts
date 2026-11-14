// Where an app keeps state. In pivi the sandbox mounts two volumes, if the
// manifest asks for them and the user approved:
//
//   /storage  permission `storage`: persistent, per app and profile, kept across
//             restarts and updates, removed when the app is uninstalled. Not
//             encrypted at rest, so keep it to what the app really needs.
//   /cache    permission `cache`: disposable. The host may wipe it at any time.
//
// Outside the sandbox (`pivi-app dev`, tests) those paths don't exist, so
// PIVI_STORAGE_DIR and PIVI_CACHE_DIR point somewhere else. Always build paths
// with these helpers instead of writing '/storage' by hand. Node and Bun only.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** The storage volume's root: `/storage` in pivi, `PIVI_STORAGE_DIR` when set. */
export function storageDir(): string {
	return process.env.PIVI_STORAGE_DIR || '/storage';
}

/** The cache volume's root: `/cache` in pivi, `PIVI_CACHE_DIR` when set. */
export function cacheDir(): string {
	return process.env.PIVI_CACHE_DIR || '/cache';
}

/** A path inside the storage volume, e.g. `storagePath('auth.json')`. */
export function storagePath(...segments: string[]): string {
	return join(storageDir(), ...segments);
}

/** A path inside the cache volume, e.g. `cachePath('thumbnails')`. */
export function cachePath(...segments: string[]): string {
	return join(cacheDir(), ...segments);
}

/** Whether the storage volume is there: false without the `storage` permission. */
export function hasStorage(): boolean {
	return existsSync(storageDir());
}

/** Whether the cache volume is there: false without the `cache` permission. */
export function hasCache(): boolean {
	return existsSync(cacheDir());
}

/** Reads a JSON file, or `undefined` when it is missing or unreadable. */
export async function readJson<T = unknown>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch {
		return undefined;
	}
}

/**
 * Writes a JSON file, creating its directory. It is written to a temporary file
 * first and renamed, so a crash mid-write never leaves a half-written file.
 * `mode` defaults to 0o600, since this is usually tokens.
 */
export async function writeJson(path: string, value: unknown, mode = 0o600): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, JSON.stringify(value), { mode });
	await rename(temporary, path);
}

/** Removes a file, and is fine when it is already gone. */
export async function removeFile(path: string): Promise<void> {
	await rm(path, { force: true });
}
