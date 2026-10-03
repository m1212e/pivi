import { describe, expect, it } from 'vitest';
import { diffManifests, domainCovered } from './manifestDiff';
import type { PluginManifest } from './manifest';

const manifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: ['network', 'storage'],
	network: { domains: ['api.example.com', '*.cdn.example.com'] },
	entryScreenId: 'main',
	...overrides
});

describe('domainCovered', () => {
	const approved = ['api.example.com', '*.cdn.example.com'];

	it('covers exact hosts and anything beneath an approved wildcard', () => {
		expect(domainCovered(approved, 'api.example.com')).toBe(true);
		expect(domainCovered(approved, 'img.cdn.example.com')).toBe(true);
		expect(domainCovered(approved, '*.cdn.example.com')).toBe(true);
		expect(domainCovered(approved, '*.eu.cdn.example.com')).toBe(true);
	});

	it('does not cover anything broader or different', () => {
		expect(domainCovered(approved, 'other.example.com')).toBe(false);
		expect(domainCovered(approved, '*.example.com')).toBe(false);
		expect(domainCovered(approved, '*.api.example.com')).toBe(false);
		expect(domainCovered(approved, '*.evilcdn.example.com')).toBe(false);
	});
});

describe('diffManifests', () => {
	it('needs no approval when nothing about access changed', () => {
		const change = diffManifests(manifest(), manifest({ version: '1.1.0', name: 'Demo 2' }));
		expect(change.needsApproval).toBe(false);
	});

	it('needs no approval when access only shrinks', () => {
		const change = diffManifests(
			manifest(),
			manifest({ permissions: ['network'], network: { domains: ['api.example.com'] } })
		);
		expect(change.needsApproval).toBe(false);
	});

	it('flags a new permission', () => {
		const change = diffManifests(
			manifest(),
			manifest({ permissions: ['network', 'storage', 'cache'] })
		);
		expect(change).toMatchObject({ addedPermissions: ['cache'], needsApproval: true });
	});

	it('flags a new or widened domain', () => {
		const change = diffManifests(
			manifest(),
			manifest({
				network: { domains: ['api.example.com', 'tracker.example.net', '*.example.com'] }
			})
		);
		expect(change.addedDomains).toEqual(['tracker.example.net', '*.example.com']);
		expect(change.needsApproval).toBe(true);
	});

	it('flags a protocol change', () => {
		expect(diffManifests(manifest(), manifest({ protocol: 2 })).protocolChanged).toBe(true);
	});

	it('treats newly adding network as asking for its domains', () => {
		const change = diffManifests(
			manifest({ permissions: ['storage'], network: undefined }),
			manifest()
		);
		expect(change.addedPermissions).toEqual(['network']);
		expect(change.addedDomains).toHaveLength(2);
	});
});
