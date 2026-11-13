import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppManifest } from '#sdk/manifest';
import { fetchAppUrl, readTextCapped } from './appFetch';
import type { AppInstance } from './runtime';
import { fetchPublic, UnsafeUrlError } from './urlGuard';

// Only the transport is faked, the per-hop checks are the real ones.
vi.mock('./urlGuard', async (original) => ({
	...(await original<typeof import('./urlGuard')>()),
	fetchPublic: vi.fn()
}));
const fetchMock = vi.mocked(fetchPublic);

// IP literals, so the public-address check needs no DNS.
const app = {
	manifest: { id: 'demo' } as AppManifest,
	allowsUrl: () => true
} as unknown as AppInstance;

const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });

afterEach(() => fetchMock.mockReset());

describe('fetchAppUrl', () => {
	it('follows a redirect that stays on public addresses', async () => {
		fetchMock
			.mockResolvedValueOnce(redirectTo('https://1.1.1.1/b'))
			.mockResolvedValueOnce(new Response('ok'));

		const response = await fetchAppUrl(app, 'https://8.8.8.8/a');
		expect(await response.text()).toBe('ok');
		expect(fetchMock.mock.calls[1][0]).toBe('https://1.1.1.1/b');
	});

	it('refuses a redirect into the LAN', async () => {
		fetchMock.mockResolvedValue(redirectTo('http://192.168.1.1/admin'));
		await expect(fetchAppUrl(app, 'https://8.8.8.8/a')).rejects.toBeInstanceOf(UnsafeUrlError);
	});

	it('refuses a redirect off the app’s domains', async () => {
		const strict = { ...app, allowsUrl: (url: string) => url.includes('8.8.8.8') } as AppInstance;
		fetchMock.mockResolvedValue(redirectTo('https://1.1.1.1/b'));
		await expect(fetchAppUrl(strict, 'https://8.8.8.8/a')).rejects.toBeInstanceOf(UnsafeUrlError);
	});

	it('gives up on a redirect loop', async () => {
		fetchMock.mockImplementation(() => Promise.resolve(redirectTo('https://8.8.8.8/a')));
		await expect(fetchAppUrl(app, 'https://8.8.8.8/a')).rejects.toBeInstanceOf(UnsafeUrlError);
	});
});

describe('readTextCapped', () => {
	it('reads a body within the cap', async () => {
		expect(await readTextCapped(new Response('hello'), 10)).toBe('hello');
	});

	it('refuses a body past the cap', async () => {
		await expect(readTextCapped(new Response('x'.repeat(11)), 10)).rejects.toBeInstanceOf(
			UnsafeUrlError
		);
	});
});
