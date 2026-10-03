import { describe, expect, it } from 'vitest';
import { assertPublicHost, isPublicAddress, UnsafeUrlError } from './urlGuard';

describe('isPublicAddress', () => {
	it('accepts ordinary public addresses', () => {
		for (const ip of ['1.1.1.1', '8.8.8.8', '104.20.23.154', '2606:4700::6810:1797']) {
			expect(isPublicAddress(ip), ip).toBe(true);
		}
	});

	it('rejects loopback, private, link-local, CGNAT and metadata ranges', () => {
		for (const ip of [
			'127.0.0.1',
			'10.1.2.3',
			'172.16.0.1',
			'172.31.255.255',
			'192.168.1.1',
			'169.254.169.254',
			'100.64.0.1',
			'0.0.0.0',
			'224.0.0.1',
			'::1',
			'::',
			'fe80::1',
			'fd12:3456::1',
			'ff02::1'
		]) {
			expect(isPublicAddress(ip), ip).toBe(false);
		}
	});

	it('judges an IPv4 address embedded in IPv6 as that IPv4 address', () => {
		expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
		expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false);
		expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
	});

	it('rejects anything that is not an IP at all', () => {
		expect(isPublicAddress('example.com')).toBe(false);
		expect(isPublicAddress('')).toBe(false);
	});
});

describe('assertPublicHost', () => {
	it('rejects literal private addresses without any lookup', async () => {
		await expect(assertPublicHost('192.168.1.10')).rejects.toBeInstanceOf(UnsafeUrlError);
		await expect(assertPublicHost('[::1]')).rejects.toBeInstanceOf(UnsafeUrlError);
	});

	it('accepts a literal public address', async () => {
		await expect(assertPublicHost('1.1.1.1')).resolves.toBeUndefined();
	});

	it('rejects localhost by resolving it', async () => {
		await expect(assertPublicHost('localhost')).rejects.toBeInstanceOf(UnsafeUrlError);
	});
});
