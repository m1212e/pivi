// A local stand-in for the sandbox's network rules. The app's traffic is routed
// through this proxy, which lets through only the manifest's domains over
// https, as the sandbox does. It sees the host name of every connection (not
// the content), which is all the rule needs.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';

export type Connection = { host: string; port: number; allowed: boolean; count: number };

export type Proxy = {
	port: number;
	connections: Map<string, Connection>;
	close(): Promise<void>;
};

export async function startProxy(allow: (host: string) => boolean): Promise<Proxy> {
	const connections = new Map<string, Connection>();
	const record = (host: string, port: number, allowed: boolean) => {
		const key = `${host}:${port}`;
		const existing = connections.get(key);
		if (existing) existing.count++;
		else connections.set(key, { host, port, allowed, count: 1 });
	};
	const sockets = new Set<Socket>();

	const server: Server = createServer((req: IncomingMessage, res) => {
		// Plain http: production only accepts https, so it is refused here too.
		let host = req.headers.host ?? 'unknown';
		try {
			host = new URL(req.url ?? '').hostname;
		} catch {
			// keep the Host header
		}
		record(host, 80, false);
		res.writeHead(403, { 'content-type': 'text/plain' });
		res.end('pivi dev proxy: plain http is not allowed, use https');
	});

	server.on('connect', (req, clientSocket: Socket, head) => {
		const [rawHost = '', rawPort = '443'] = (req.url ?? '').split(':');
		const host = rawHost.toLowerCase();
		const port = Number(rawPort) || 443;
		const allowed = allow(host);
		record(host, port, allowed);
		sockets.add(clientSocket);
		clientSocket.on('close', () => sockets.delete(clientSocket));
		clientSocket.on('error', () => clientSocket.destroy());
		if (!allowed) {
			clientSocket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n');
			return;
		}
		const upstream = connect(port, host, () => {
			clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			if (head.length) upstream.write(head);
			upstream.pipe(clientSocket);
			clientSocket.pipe(upstream);
		});
		sockets.add(upstream);
		upstream.on('close', () => sockets.delete(upstream));
		upstream.on('error', () => {
			clientSocket.destroy();
			upstream.destroy();
		});
	});

	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	return {
		port: (server.address() as AddressInfo).port,
		connections,
		close: () =>
			new Promise<void>((done) => {
				for (const socket of sockets) socket.destroy();
				server.close(() => done());
			})
	};
}
