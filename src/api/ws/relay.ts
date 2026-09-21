import { WebSocketServer, WebSocket } from 'ws';
import { PAIRING_WS_PORT } from '#lib/wsConfig';

// A phone remote and its paired TV both connect here and get dropped into the
// same room; any message one side sends is relayed verbatim to the other.
// There's no interpretation here — the TV client decides what a
// `move`/`select`/`key`/`text` message means.
const room = new Set<WebSocket>();

function broadcast(sender: WebSocket, data: string) {
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

	wss.on('connection', (socket) => {
		room.add(socket);

		socket.on('message', (data) => broadcast(socket, data.toString()));
		socket.on('close', () => room.delete(socket));
	});
}
