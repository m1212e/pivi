import { describe, expect, it } from 'vitest';
import { formatImageRef, parseImageRef, registryApiHost } from './imageRef';

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
