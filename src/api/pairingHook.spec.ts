// The remote page is the one path the LAN can reach, so it must never be how
// a device on the network gets hold of a pairing token.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./lan', () => ({ getLanAddressOrHostname: () => '192.168.1.20' }));
vi.mock('./db', () => ({ db: {} }));

const { handlePairing } = await import('./pairingHook');

async function request(path: string) {
	const url = new URL(`http://localhost:3000${path}`);
	const setCookies: string[] = [];
	const event = {
		url,
		request: new Request(url),
		locals: {} as App.Locals,
		cookies: {
			get: () => undefined,
			set: (name: string, value: string) => setCookies.push(`${name}=${value}`)
		}
	};
	await handlePairing({
		event: event as never,
		resolve: () => Promise.resolve(new Response('ok'))
	});
	return { setCookies, locals: event.locals };
}

describe('handlePairing', () => {
	it('never mints one for the remote page', async () => {
		for (const path of ['/remote', '/remote/', '/remote/sw.js']) {
			const { setCookies, locals } = await request(path);
			expect(setCookies).toEqual([]);
			expect(locals.pairingToken).toBeUndefined();
		}
	});

	it('puts the token for the TV in the QR url fragment, not the path', async () => {
		const { locals } = await request('/');
		expect(locals.pairingToken).toBeTruthy();
		expect(locals.remoteUrl).toBe(`http://192.168.1.20:3000/remote#${locals.pairingToken}`);
	});
});
