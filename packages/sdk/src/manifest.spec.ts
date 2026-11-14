import { describe, expect, it } from 'vitest';
import { domainsAllow, domainSchema, appManifestSchema } from './manifest';

const base = {
	id: 'demo',
	name: 'Demo',
	version: '1.0.0',
	protocol: 2,
	features: ['dashboard'],
	permissions: []
};

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

describe('appManifestSchema', () => {
	it('defaults the entry screen', () => {
		expect(appManifestSchema.parse(base).entryScreenId).toBe('main');
	});

	it('requires domains exactly when network is requested', () => {
		expect(appManifestSchema.safeParse({ ...base, permissions: ['network'] }).success).toBe(false);
		expect(
			appManifestSchema.safeParse({ ...base, network: { domains: ['example.com'] } }).success
		).toBe(false);
		expect(
			appManifestSchema.safeParse({
				...base,
				permissions: ['network'],
				network: { domains: ['example.com'] }
			}).success
		).toBe(true);
	});

	it('rejects unknown permissions and duplicates', () => {
		expect(appManifestSchema.safeParse({ ...base, permissions: ['filesystem'] }).success).toBe(
			false
		);
		expect(appManifestSchema.safeParse({ ...base, permissions: ['cache', 'cache'] }).success).toBe(
			false
		);
	});
});
