import { WebSocketServer, WebSocket } from 'ws';
import { PAIRING_WS_PORT } from '#lib/wsConfig';

// A phone remote and its paired TV both connect here at /<pairing-token> and
// get dropped into the same "room"; any message one side sends is relayed
// verbatim to the other. There's no interpretation here — the TV client
// decides what a `move`/`select`/`key`/`text` message means.
const rooms = new Map<string, Set<WebSocket>>();

function broadcast(token: string, sender: WebSocket, data: string) {
	const room = rooms.get(token);
	if (!room) return;

	for (const socket of room) {
		if (socket !== sender && socket.readyState === WebSocket.OPEN) socket.send(data);
	}
}

declare global {
	var __piviPairingRelayStarted: boolean | undefined;
}

export function startPairingRelay() {
	// Vite's dev SSR module runner re-executes this module on unrelated file
	// edits (HMR); guard against binding the port twice in the same process.
	if (globalThis.__piviPairingRelayStarted) return;
	globalThis.__piviPairingRelayStarted = true;

	const wss = new WebSocketServer({ port: PAIRING_WS_PORT });

	wss.on('connection', (socket, request) => {
		const token = new URL(request.url ?? '', 'http://localhost').pathname.replace(/^\//, '');
		if (!token) {
			socket.close();
			return;
		}

		let room = rooms.get(token);
		if (!room) {
			room = new Set();
			rooms.set(token, room);
		}
		room.add(socket);

		socket.on('message', (data) => broadcast(token, socket, data.toString()));
		socket.on('close', () => {
			room?.delete(socket);
			if (room?.size === 0) rooms.delete(token);
		});
	});
}
