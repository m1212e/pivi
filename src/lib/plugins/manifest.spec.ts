import { describe, expect, it } from 'vitest';
import { domainsAllow, domainSchema, pluginManifestSchema } from './manifest';
import { formatImageRef, parseImageRef, registryApiHost } from './imageRef';

const base = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 1,
	features: ['dashboard'],
	permissions: []
};

describe('parseImageRef', () => {
	it('puts bare names on Docker Hub under library/', () => {
		expect(parseImageRef('nginx')).toEqual({
			registry: 'docker.io',
			repository: 'library/nginx',
			tag: 'latest',
			digest: undefined
		});
	});

	it('keeps owner/name on Docker Hub', () => {
		expect(formatImageRef(parseImageRef('someone/pivi-youtube:1.2'))).toBe(
			'docker.io/someone/pivi-youtube:1.2'
		);
	});

	it('treats a host-looking first component as the registry', () => {
		expect(formatImageRef(parseImageRef('ghcr.io/owner/name:v1'))).toBe('ghcr.io/owner/name:v1');
		expect(parseImageRef('localhost:5000/name')).toMatchObject({
			registry: 'localhost:5000',
			repository: 'name',
			tag: 'latest'
		});
		expect(parseImageRef('localhost/name').registry).toBe('localhost');
	});

	it('does not mistake a registry port for a tag', () => {
		expect(parseImageRef('registry.example.com:5000/a/b')).toMatchObject({
			registry: 'registry.example.com:5000',
			repository: 'a/b',
			tag: 'latest'
		});
	});

	it('accepts a digest, with no implied tag', () => {
		const digest = `sha256:${'a'.repeat(64)}`;
		expect(parseImageRef(`ghcr.io/o/n@${digest}`)).toMatchObject({ tag: undefined, digest });
	});

	it('rejects malformed references', () => {
		expect(() => parseImageRef('')).toThrow();
		expect(() => parseImageRef('Owner/Name')).toThrow();
		expect(() => parseImageRef('a/b@sha256:short')).toThrow();
		expect(() => parseImageRef('a//b')).toThrow();
	});

	it('normalizes the docker hub api host', () => {
		expect(parseImageRef('index.docker.io/o/n').registry).toBe('docker.io');
		expect(registryApiHost('docker.io')).toBe('registry-1.docker.io');
		expect(registryApiHost('ghcr.io')).toBe('ghcr.io');
	});
});

describe('domainSchema', () => {
	it('accepts hostnames and *.suffix wildcards', () => {
		for (const d of ['example.com', 'www.youtube.com', '*.googlevideo.com']) {
			expect(domainSchema.safeParse(d).success).toBe(true);
		}
	});

	it('rejects IPs, ports, paths, bare and over-broad wildcards', () => {
		for (const d of ['*', '*.com', '1.2.3.4', '*.1.2', 'a.com:443', 'a.com/x', 'localhost', '']) {
			expect(domainSchema.safeParse(d).success, d).toBe(false);
		}
	});
});

describe('domainsAllow', () => {
	it('matches exact hosts and wildcard suffixes only', () => {
		const domains = ['www.youtube.com', '*.googlevideo.com'];
		expect(domainsAllow(domains, 'www.youtube.com')).toBe(true);
		expect(domainsAllow(domains, 'rr3.sn-x.googlevideo.com')).toBe(true);
		expect(domainsAllow(domains, 'googlevideo.com')).toBe(true);
		expect(domainsAllow(domains, 'youtube.com')).toBe(false);
		expect(domainsAllow(domains, 'evilgooglevideo.com')).toBe(false);
		expect(domainsAllow(domains, 'googlevideo.com.evil.org')).toBe(false);
	});
});

describe('pluginManifestSchema', () => {
	it('defaults the entry screen', () => {
		expect(pluginManifestSchema.parse(base).entryScreenId).toBe('main');
	});

	it('requires domains exactly when network is requested', () => {
		expect(pluginManifestSchema.safeParse({ ...base, permissions: ['network'] }).success).toBe(
			false
		);
		expect(
			pluginManifestSchema.safeParse({ ...base, network: { domains: ['example.com'] } }).success
		).toBe(false);
		expect(
			pluginManifestSchema.safeParse({
				...base,
				permissions: ['network'],
				network: { domains: ['example.com'] }
			}).success
		).toBe(true);
	});

	it('rejects unknown permissions and duplicates', () => {
		expect(pluginManifestSchema.safeParse({ ...base, permissions: ['filesystem'] }).success).toBe(
			false
		);
		expect(
			pluginManifestSchema.safeParse({ ...base, permissions: ['cache', 'cache'] }).success
		).toBe(false);
	});
});
