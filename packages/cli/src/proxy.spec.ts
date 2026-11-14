import { connect } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { startProxy, type Proxy } from './proxy';

let proxy: Proxy | undefined;
afterEach(async () => {
	await proxy?.close();
});

const connectVia = (port: number, target: string) =>
	new Promise<string>((resolve) => {
		const socket = connect(port, '127.0.0.1', () =>
			socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
		);
		socket.once('data', (data) => {
			resolve(data.toString().split('\r\n')[0] ?? '');
			socket.destroy();
		});
	});

it('refuses hosts the rule does not allow and remembers them', async () => {
	proxy = await startProxy((host) => host === 'ok.example.com');
	expect(await connectVia(proxy.port, 'nope.example.com:443')).toContain('403');
	expect(proxy.connections.get('nope.example.com:443')).toMatchObject({ allowed: false, count: 1 });
});

it('refuses plain http as the production host does', async () => {
	proxy = await startProxy(() => true);
	const response = await fetch(`http://127.0.0.1:${proxy.port}/`, {
		headers: { host: 'x.example.com' }
	});
	expect(response.status).toBe(403);
});
