import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeRegistry, seedBaseImage, type FakeRegistry } from '../../test/fakeRegistry';
import { parseChallenge } from './auth';
import { RegistryClient } from './client';
import { buildImage } from './image';
import { pushImage } from './push';
import { parseReference } from './reference';
import { tar } from './tar';

const LABEL = JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0' });

describe('image references', () => {
	it('fill in Docker Hub, library/ and latest', () => {
		expect(parseReference('oven/bun:1')).toEqual({
			registry: 'docker.io',
			repository: 'oven/bun',
			tag: '1',
			digest: undefined
		});
		expect(parseReference('alpine')).toMatchObject({ repository: 'library/alpine', tag: 'latest' });
		expect(parseReference('localhost:5000/a/b')).toMatchObject({
			registry: 'localhost:5000',
			repository: 'a/b',
			tag: 'latest'
		});
		expect(parseReference(`ghcr.io/me/app@sha256:${'a'.repeat(64)}`)).toMatchObject({
			tag: undefined,
			digest: `sha256:${'a'.repeat(64)}`
		});
		expect(() => parseReference('ghcr.io/Me/App')).toThrow(/Invalid repository/);
	});

	it('parse bearer challenges', () => {
		expect(
			parseChallenge(
				'Bearer realm="https://auth.example/token",service="reg",scope="repository:a:pull"'
			)
		).toEqual({
			scheme: 'bearer',
			realm: 'https://auth.example/token',
			service: 'reg',
			scope: 'repository:a:pull'
		});
		expect(parseChallenge('Basic realm="x"')).toEqual({ scheme: 'basic' });
	});
});

describe('tar', () => {
	it('is reproducible and readable by tar', () => {
		const entries = [
			{ path: 'app/' },
			{ path: 'app/main.mjs', content: Buffer.from('console.error(1)\n') }
		];
		expect(tar(entries).equals(tar(entries))).toBe(true);
		const dir = mkdtempSync(join(tmpdir(), 'pivi-tar-'));
		writeFileSync(join(dir, 'layer.tar'), tar(entries));
		const listing = execFileSync('tar', ['-tvf', join(dir, 'layer.tar')], { encoding: 'utf8' });
		expect(listing).toMatch(/app\/main\.mjs/);
		expect(listing).toMatch(/root\/root/);
	});
});

describe('building and publishing', () => {
	let source: FakeRegistry;
	beforeEach(async () => {
		// Keep downloaded test blobs out of the real ~/.cache.
		process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), 'pivi-cache-'));
		source = await startFakeRegistry();
	});
	afterEach(async () => {
		await source.close();
	});

	function build(bundle = 'console.error("hi")') {
		const base = seedBaseImage(source);
		return buildImage({ bundle: Buffer.from(bundle), manifestLabel: LABEL, base });
	}

	it('puts the app on top of every platform of the base', async () => {
		const image = await build();
		expect(image.platforms.map((p) => p.platform.architecture)).toEqual(['amd64', 'arm64']);
		for (const { manifest, config } of image.platforms) {
			const m = JSON.parse(manifest.bytes.toString());
			expect(m.layers).toHaveLength(2);
			expect(m.layers[1].digest).toBe(image.appLayer.digest);
			const c = JSON.parse(config.bytes.toString());
			expect(c.config.Entrypoint).toEqual(['node', '/app/main.mjs']);
			expect(c.config.Cmd).toBeUndefined();
			expect(c.config.WorkingDir).toBe('/app');
			expect(c.config.Labels).toEqual({ base: 'yes', 'dev.pivi.manifest': LABEL });
			expect(c.rootfs.diff_ids).toHaveLength(2);
			expect(c.created).toBeUndefined();
		}
	});

	it('ships the bundle at the path the entrypoint runs', async () => {
		const image = await build('the bundle');
		const dir = mkdtempSync(join(tmpdir(), 'pivi-layer-'));
		writeFileSync(join(dir, 'layer.tar'), gunzipSync(image.appLayer.bytes));
		execFileSync('tar', ['-xf', join(dir, 'layer.tar'), '-C', dir]);
		const config = JSON.parse(image.platforms[0]!.config.bytes.toString());
		const [runtime, file] = config.config.Entrypoint;
		expect(runtime).toBe('node');
		expect(readFileSync(join(dir, file), 'utf8')).toBe('the bundle');
	});

	it('is reproducible, and the bundle changes the digest', async () => {
		expect((await build()).index.digest).toBe((await build()).index.digest);
		expect((await build('other')).index.digest).not.toBe((await build()).index.digest);
	});

	it('mounts base layers within one registry and uploads nothing twice', async () => {
		const image = await build();
		const target = parseReference(`${source.host}/me/app:1.0.0`);
		const result = await pushImage(image, { target, tags: ['latest'] });
		expect(source.counts.mounts).toBe(2);
		expect(result.references).toEqual([
			`${source.host}/me/app:1.0.0`,
			`${source.host}/me/app:latest`
		]);

		const client = new RegistryClient(source.host);
		const index = await client.manifest('me/app', 'latest');
		expect(index.digest).toBe(image.index.digest);

		const before = { ...source.counts };
		await pushImage(image, { target });
		expect(source.counts).toEqual(before);
	});

	it('copies base layers to another registry, and needs credentials there', async () => {
		const image = await build();
		const target = await startFakeRegistry({ auth: true });
		try {
			const ref = parseReference(`${target.host}/me/app:1`);
			await expect(
				pushImage(image, { target: ref, client: new RegistryClient(target.host, undefined) })
			).rejects.toThrow(/refused a token|needs credentials/);
			await pushImage(image, {
				target: ref,
				client: new RegistryClient(target.host, { username: 'user', password: 'pass' })
			});
			// Two base layers, the app layer and two configs.
			expect(target.counts.uploads).toBe(5);
			expect(target.manifests.has(`me/app:1`)).toBe(true);
		} finally {
			await target.close();
		}
	});
});
