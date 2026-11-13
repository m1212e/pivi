import { describe, expect, it } from 'vitest';
import { parseImageRef } from '#lib/apps/imageRef';
import type { AppManifest } from '#sdk/manifest';
import {
	buildSandboxSpec,
	volumeBelongsToApp,
	volumeBelongsToProfile,
	volumeName,
	volumeOfUnknownProfile
} from './spec';

const manifest: AppManifest = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 2,
	features: [],
	permissions: ['network', 'storage', 'cache'],
	network: { domains: ['api.example.com', '*.cdn.example.com'] },
	entryScreenId: 'main'
};
const digest = `sha256:${'b'.repeat(64)}`;

const build = (granted: AppManifest['permissions'], m: AppManifest = manifest) =>
	buildSandboxSpec({
		ref: parseImageRef('ghcr.io/acme/demo:1.0'),
		image: { digest, command: ['/run', '--x'], workingDir: '/app' },
		manifest: m,
		granted,
		userId: 'user-1'
	});

describe('buildSandboxSpec', () => {
	it('boots the pinned digest, never the tag', () => {
		const spec = build([]);
		expect(spec.image).toBe(`ghcr.io/acme/demo@${digest}`);
		expect(spec).toMatchObject({ command: ['/run', '--x'], workingDir: '/app' });
	});

	it('gives an app with nothing granted no network and no volumes', () => {
		const spec = build([]);
		expect(spec.network).toBeNull();
		expect(spec.volumes).toEqual([]);
	});

	it('opens exactly the declared domains when network is granted', () => {
		expect(build(['network']).network).toEqual({
			domains: ['api.example.com', '*.cdn.example.com']
		});
	});

	it('mounts storage and cache only when granted, each as its own volume', () => {
		expect(build(['storage']).volumes.map((v) => v.guestPath)).toEqual(['/storage']);
		expect(build(['cache']).volumes.map((v) => v.guestPath)).toEqual(['/cache']);
		const both = build(['storage', 'cache']).volumes;
		expect(new Set(both.map((v) => v.name)).size).toBe(2);
		expect(both.every((v) => v.quotaMiB > 0)).toBe(true);
	});

	it('ignores a grant for something the manifest never asked for', () => {
		const modest: AppManifest = { ...manifest, permissions: ['storage'], network: undefined };
		const spec = build(['network', 'storage', 'cache'], modest);
		expect(spec.network).toBeNull();
		expect(spec.volumes.map((v) => v.guestPath)).toEqual(['/storage']);
	});

	it('gives each profile its own volumes', () => {
		expect(volumeName('demo', 'user-1', 'storage')).not.toBe(
			volumeName('demo', 'user-2', 'storage')
		);
		expect(volumeName('demo', 'user-1', 'storage')).toBe(volumeName('demo', 'user-1', 'storage'));
	});
});

describe('volume ownership', () => {
	const mine = volumeName('demo', 'user-1', 'storage');
	const otherProfile = volumeName('demo', 'user-2', 'storage');
	const otherApp = volumeName('demo-two', 'user-1', 'storage');

	it("matches an app's volumes across profiles, and only that app's", () => {
		const owns = volumeBelongsToApp('demo');
		expect([mine, otherProfile, otherApp].filter(owns)).toEqual([mine, otherProfile]);
	});
});

describe('profile volume matching', () => {
	const mine = volumeName('demo', 'user-1', 'storage');
	const theirs = volumeName('other-app', 'user-2', 'cache');

	it('matches one profile’s volumes across apps', () => {
		expect(volumeBelongsToProfile('user-1')(mine)).toBe(true);
		expect(volumeBelongsToProfile('user-1')(volumeName('other-app', 'user-1', 'cache'))).toBe(true);
		expect(volumeBelongsToProfile('user-1')(theirs)).toBe(false);
	});

	it('finds volumes of profiles that no longer exist', () => {
		const orphaned = volumeOfUnknownProfile(['user-1']);
		expect(orphaned(mine)).toBe(false);
		expect(orphaned(theirs)).toBe(true);
	});

	it('never matches a volume it didn’t name', () => {
		for (const name of ['pivi-demo', 'someone-elses-volume', 'pivi-demo_notakey_storage']) {
			expect(volumeOfUnknownProfile([])(name)).toBe(false);
		}
	});
});
