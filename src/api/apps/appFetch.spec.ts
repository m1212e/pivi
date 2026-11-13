import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppManifest } from '#sdk/manifest';
import { fetchAppUrl } from './appFetch';
import type { AppInstance } from './runtime';
import { UnsafeUrlError } from './urlGuard';

// IP literals, so the public-address check needs no DNS.
const app = {
	manifest: { id: 'demo' } as AppManifest,
	allowsUrl: () => true
} as unknown as AppInstance;

const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });

afterEach(() => vi.unstubAllGlobals());

describe('fetchAppUrl', () => {
	it('follows a redirect that stays on public addresses', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(redirectTo('https://1.1.1.1/b'))
			.mockResolvedValueOnce(new Response('ok'));
		vi.stubGlobal('fetch', fetchMock);

		const response = await fetchAppUrl(app, 'https://8.8.8.8/a');
		expect(await response.text()).toBe('ok');
		expect(fetchMock.mock.calls[1][0]).toBe('https://1.1.1.1/b');
		expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
	});

	it('refuses a redirect into the LAN', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirectTo('http://192.168.1.1/admin')));
		await expect(fetchAppUrl(app, 'https://8.8.8.8/a')).rejects.toBeInstanceOf(UnsafeUrlError);
	});

	it('refuses a redirect off the app’s domains', async () => {
		const strict = { ...app, allowsUrl: (url: string) => url.includes('8.8.8.8') } as AppInstance;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirectTo('https://1.1.1.1/b')));
		await expect(fetchAppUrl(strict, 'https://8.8.8.8/a')).rejects.toBeInstanceOf(UnsafeUrlError);
	});

	it('gives up on a redirect loop', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(() => Promise.resolve(redirectTo('https://8.8.8.8/a')))
		);
		await expect(fetchAppUrl(app, 'https://8.8.8.8/a')).rejects.toBeInstanceOf(UnsafeUrlError);
	});
});
