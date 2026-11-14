import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	cachePath,
	hasCache,
	hasStorage,
	readJson,
	removeFile,
	storagePath,
	writeJson
} from './storage';

const saved = { storage: process.env.PIVI_STORAGE_DIR, cache: process.env.PIVI_CACHE_DIR };
afterEach(() => {
	process.env.PIVI_STORAGE_DIR = saved.storage;
	process.env.PIVI_CACHE_DIR = saved.cache;
	if (saved.storage === undefined) delete process.env.PIVI_STORAGE_DIR;
	if (saved.cache === undefined) delete process.env.PIVI_CACHE_DIR;
});

describe('storage paths', () => {
	it('are the sandbox volumes by default', () => {
		delete process.env.PIVI_STORAGE_DIR;
		delete process.env.PIVI_CACHE_DIR;
		expect(storagePath('auth.json')).toBe('/storage/auth.json');
		expect(cachePath('a', 'b')).toBe('/cache/a/b');
	});

	it('follow the environment, read on every call', () => {
		process.env.PIVI_STORAGE_DIR = '/tmp/s';
		process.env.PIVI_CACHE_DIR = '/tmp/c';
		expect(storagePath('auth.json')).toBe('/tmp/s/auth.json');
		expect(cachePath('x')).toBe('/tmp/c/x');
	});

	it('report whether the volume exists', () => {
		process.env.PIVI_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'pivi-storage-'));
		process.env.PIVI_CACHE_DIR = join(tmpdir(), 'pivi-does-not-exist-hopefully');
		expect(hasStorage()).toBe(true);
		expect(hasCache()).toBe(false);
	});
});

describe('JSON files', () => {
	it('round-trip, create directories and stay private', async () => {
		const path = join(mkdtempSync(join(tmpdir(), 'pivi-json-')), 'nested', 'tokens.json');
		await writeJson(path, { token: 'abc' });
		expect(await readJson(path)).toEqual({ token: 'abc' });
		expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ token: 'abc' });
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it('read as undefined when missing or broken, and remove idempotently', async () => {
		const path = join(mkdtempSync(join(tmpdir(), 'pivi-json-')), 'missing.json');
		expect(await readJson(path)).toBeUndefined();
		await removeFile(path);
		await removeFile(path);
	});
});
