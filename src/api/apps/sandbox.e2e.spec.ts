// End to end through the real pieces: a registry, cosign's signature format, the
// installer, a microsandbox microVM and the stdio protocol. It needs KVM and a
// published, signed app image, so it only runs when pointed at one:
//
//   PIVI_E2E_IMAGE=localhost:5055/pivi-youtube:0.1.0 \
//   PIVI_E2E_PUBLIC_KEY=/path/to/cosign.pub \
//   PIVI_SANDBOX_HOME=/tmp/msbh \
//   npx vitest run --project server sandbox.e2e
//
// (Build and sign the image with `bun run app:build` and `cosign sign`; see
// docs/apps.md.) The image is expected to be the YouTube app.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseImageRef } from '#lib/apps/imageRef';
import type { AppDeps } from './deps';
import { installApp, previewInstall } from './installer';
import { memoryStore } from './fixtures';
import { RegistryClient } from './registry';
import { loadApp } from './runtime';
import { buildSandboxSpec, volumeBelongsToApp } from './sandbox/spec';
import { microsandboxBackend } from './sandbox/microsandbox';
import { SignatureError, verifyImageSignature } from './signature';

// The runtime reaches the paired phones and the LAN address; neither exists here.
vi.mock('../ws/relay', () => ({ sendToPhones: vi.fn() }));
vi.mock('../lan', () => ({ getLanAddress: () => '127.0.0.1' }));

const IMAGE = process.env.PIVI_E2E_IMAGE;
const PUBLIC_KEY = process.env.PIVI_E2E_PUBLIC_KEY;

const deps: AppDeps = {
	store: memoryStore(),
	registry: new RegistryClient(),
	backend: microsandboxBackend,
	verify: verifyImageSignature,
	control: {
		isRunning: () => false,
		stop: () => Promise.resolve(),
		restart: () => Promise.resolve()
	}
};

async function until<T>(read: () => T | undefined, timeoutMs: number): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = read();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error('Timed out waiting');
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

describe.skipIf(!IMAGE || !PUBLIC_KEY)('a signed app image, sandboxed', () => {
	const publicKey = PUBLIC_KEY ? readFileSync(PUBLIC_KEY, 'utf8') : '';

	it('previews what it asks for once its signature checks out', async () => {
		const preview = await previewInstall(deps, { image: IMAGE!, publicKey });
		expect(preview.manifest.id).toBe('youtube');
		expect(preview.manifest.permissions).toEqual(['network', 'storage', 'cache']);
		expect(preview.signer?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(preview.conflict).toBe(false);
	});

	it('refuses an image that was not signed by the given key', async () => {
		// A well-formed key that signed nothing.
		const stranger = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhyQCx0E9wQWSFI9ULGwy3BuRklnt
IqozONbbdbqz11hlRJy9c7SG+hdcFl9jE9uE/dwtuwU2MqU9T/cN0YkWww==
-----END PUBLIC KEY-----`;
		await expect(
			previewInstall(deps, { image: IMAGE!, publicKey: stranger })
		).rejects.toBeInstanceOf(SignatureError);
	});

	it('runs under its granted permissions and speaks the protocol', async () => {
		const row = await installApp(deps, {
			image: IMAGE!,
			publicKey,
			granted: ['network', 'storage', 'cache']
		});
		expect(row.imageDigest).toMatch(/^sha256:/);

		const spec = buildSandboxSpec({
			ref: parseImageRef(row.imageRef),
			image: { digest: row.imageDigest, command: row.imageCommand },
			manifest: row.approvedManifest,
			granted: row.grantedPermissions,
			userId: 'e2e-user'
		});
		expect(spec.network?.domains).toContain('*.googlevideo.com');

		const app = await loadApp({
			manifest: row.approvedManifest,
			granted: row.grantedPermissions,
			start: (handlers) => microsandboxBackend.start(spec, handlers)
		});

		try {
			// It published what its manifest says it provides.
			const screen = await until(() => app.getScreen('browse'), 60_000);
			expect(screen.root.type).toBe('container');
			expect(app.getDashboard()?.cards).toEqual([]);

			// A real playback resolution: yt-dlp inside the VM, through the network policy.
			const stream = await app.resolveStream('dQw4w9WgXcQ');
			expect(stream.title.length).toBeGreaterThan(0);
			expect(app.allowsUrl(stream.videoUrl)).toBe(true);
			expect(app.allowsUrl('http://127.0.0.1:5432/')).toBe(false);
			expect(app.allowsUrl('https://example.com/video.mp4')).toBe(false);
		} finally {
			await app.dispose();
			await microsandboxBackend.removeVolumes(volumeBelongsToApp('youtube'));
		}
	}, 600_000);

	it('cannot reach the network when that permission is not granted', async () => {
		const row = (await deps.store.find('youtube'))!;
		const spec = buildSandboxSpec({
			ref: parseImageRef(row.imageRef),
			image: { digest: row.imageDigest, command: row.imageCommand },
			manifest: row.approvedManifest,
			granted: ['storage'],
			userId: 'e2e-user'
		});
		expect(spec.network).toBeNull();

		// The YouTube app can't start with no network at all; the point is that
		// it's the sandbox, not the app's goodwill, that says so.
		await expect(
			loadApp({
				manifest: row.approvedManifest,
				granted: ['storage'],
				start: (handlers) => microsandboxBackend.start(spec, handlers)
			})
		).rejects.toThrow();
		await microsandboxBackend.removeVolumes(volumeBelongsToApp('youtube'));
	}, 300_000);
});
