import { eq } from 'drizzle-orm';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import { PAIRING_WS_PORT } from '#lib/wsConfig';
import {
	decrypt,
	deriveSharedSecret,
	deriveSessionKeys,
	encrypt,
	fromBase64Url,
	generateEphemeralKeypair,
	sign,
	toBase64Url,
	verify,
	concatBytes,
	utf8ToBytes,
	bytesToUtf8
} from '#lib/crypto/pairing';
import {
	challengeResponseSchema,
	helloRequestSchema,
	pairRequestSchema,
	phoneToRelaySchema,
	tvHelloSchema,
	type AuthError,
	type Challenge,
	type ChallengeResponse,
	type Encrypted,
	type HelloRequest,
	type PairError,
	type PairRequest,
	type PairSuccess,
	type PhoneToRelay,
	type Ready
} from '#lib/pairing/protocol';
import {
	remoteConnectedNotification,
	remoteDisconnectedNotification
} from '#lib/pairing/remoteProtocol';
import { db } from '../db';
import { pairedDevice } from '../db/schema';
import { consumePairingToken, getOrCreateTvIdentity, isPairingTokenValid } from '../pairing';

const HANDSHAKE_TIMEOUT_MS = 10_000;

type ConnState =
	| { role: 'unauth'; timeout: ReturnType<typeof setTimeout> }
	| {
			role: 'awaiting-response';
			timeout: ReturnType<typeof setTimeout>;
			deviceId: string;
			devicePublicKey: Uint8Array;
			transcript: Uint8Array;
			relayEphemeralSecretKey: Uint8Array;
	  }
	| { role: 'tv' }
	| { role: 'phone'; deviceId: string; c2sKey: Uint8Array; s2cKey: Uint8Array };

const connections = new Map<WebSocket, ConnState>();

function send(socket: WebSocket, message: object) {
	if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function isLoopback(address: string | undefined) {
	return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function fail(socket: WebSocket, message: object) {
	send(socket, message);
	socket.close();
}

function tvSockets() {
	return [...connections].filter(([, state]) => state.role === 'tv').map(([socket]) => socket);
}

function phoneSocketsWithKeys() {
	return [...connections].filter(
		(entry): entry is [WebSocket, Extract<ConnState, { role: 'phone' }>] =>
			entry[1].role === 'phone'
	);
}

async function handlePairRequest(socket: WebSocket, message: PairRequest) {
	const { token, devicePublicKey } = message;
	if (!isPairingTokenValid(token)) {
		fail(socket, {
			type: 'pairError',
			message: 'Pairing code expired or already used'
		} satisfies PairError);
		return;
	}

	const tvIdentity = await getOrCreateTvIdentity();
	const [row] = await db.insert(pairedDevice).values({ publicKey: devicePublicKey }).returning();

	// Only burn the token once pairing has actually succeeded, so a
	// transient failure above doesn't permanently invalidate the still
	// displayed QR code.
	consumePairingToken(token);

	clearHandshakeTimeout(socket);
	connections.set(socket, { role: 'unauth', timeout: startHandshakeTimeout(socket) });

	send(socket, {
		type: 'paired',
		deviceId: row.id,
		tvPublicKey: toBase64Url(tvIdentity.publicKey)
	} satisfies PairSuccess);
}

async function handleHelloRequest(socket: WebSocket, message: HelloRequest) {
	const { deviceId, ephemeralPublicKey } = message;
	const device = await db.query.pairedDevice.findFirst({ where: { id: deviceId } });
	if (!device) {
		fail(socket, { type: 'authError', message: 'Unknown device' } satisfies AuthError);
		return;
	}

	const phoneEphemeralPublicKey = fromBase64Url(ephemeralPublicKey);
	const relayEphemeral = generateEphemeralKeypair();
	const transcript = concatBytes(
		phoneEphemeralPublicKey,
		relayEphemeral.publicKey,
		utf8ToBytes(deviceId)
	);

	const tvIdentity = await getOrCreateTvIdentity();
	const signature = sign(tvIdentity.secretKey, transcript);

	clearHandshakeTimeout(socket);
	connections.set(socket, {
		role: 'awaiting-response',
		timeout: startHandshakeTimeout(socket),
		deviceId,
		devicePublicKey: fromBase64Url(device.publicKey),
		transcript,
		relayEphemeralSecretKey: relayEphemeral.secretKey
	});

	send(socket, {
		type: 'challenge',
		ephemeralPublicKey: toBase64Url(relayEphemeral.publicKey),
		signature: toBase64Url(signature)
	} satisfies Challenge);
}

async function handleChallengeResponse(
	socket: WebSocket,
	state: Extract<ConnState, { role: 'awaiting-response' }>,
	message: ChallengeResponse
) {
	const { signature } = message;
	if (!verify(state.devicePublicKey, state.transcript, fromBase64Url(signature))) {
		fail(socket, {
			type: 'authError',
			message: 'Signature verification failed'
		} satisfies AuthError);
		return;
	}

	// The phone's ephemeral public key is the first component baked into the
	// transcript we signed in handleHelloRequest.
	const phoneEphemeralPublicKey = state.transcript.slice(0, 32);
	const sharedSecret = deriveSharedSecret(state.relayEphemeralSecretKey, phoneEphemeralPublicKey);
	// Directions are named from the phone's perspective: c2s is what the
	// relay decrypts, s2c is what it encrypts — mirrored in session.ts.
	const { c2sKey, s2cKey } = deriveSessionKeys(sharedSecret, state.transcript);

	clearHandshakeTimeout(socket);
	connections.set(socket, { role: 'phone', deviceId: state.deviceId, c2sKey, s2cKey });
	await db
		.update(pairedDevice)
		.set({ lastSeenAt: new Date() })
		.where(eq(pairedDevice.id, state.deviceId));

	send(socket, { type: 'ready' } satisfies Ready);

	// Tells whatever TV(s) are listening that a phone just finished
	// connecting, so RemoteBridge can surface a toast — sent directly rather
	// than through relayFromPhone, since that path only forwards the phone's
	// own encrypted app-level messages (move/select/etc), not relay-originated
	// status events. Framed as a JSON-RPC notification (see
	// pairing/remoteProtocol.ts) like every other message on this channel,
	// even though the relay itself has no stake in the RPC connection.
	for (const tv of tvSockets()) {
		send(tv, { jsonrpc: '2.0', method: remoteConnectedNotification.method });
	}
}

function startHandshakeTimeout(socket: WebSocket) {
	return setTimeout(() => {
		fail(socket, { type: 'authError', message: 'Handshake timed out' } satisfies AuthError);
	}, HANDSHAKE_TIMEOUT_MS);
}

function clearHandshakeTimeout(socket: WebSocket) {
	const state = connections.get(socket);
	if (state && 'timeout' in state) clearTimeout(state.timeout);
}

declare global {
	var __piviPairingRelayStarted: boolean | undefined;
}

export function startPairingRelay() {
	if (globalThis.__piviPairingRelayStarted) return;
	globalThis.__piviPairingRelayStarted = true;

	const wss = new WebSocketServer({ port: PAIRING_WS_PORT });

	wss.on('connection', (socket, request) => {
		const remoteAddress = request.socket.remoteAddress;
		connections.set(socket, { role: 'unauth', timeout: startHandshakeTimeout(socket) });

		socket.on('message', (data: RawData) => onMessage(socket, remoteAddress, data));
		socket.on('close', () => {
			clearHandshakeTimeout(socket);
			const state = connections.get(socket);
			connections.delete(socket);

			// Only a fully-connected phone leaving is noteworthy — not every
			// dropped socket (e.g. one that never finished the handshake).
			if (state?.role === 'phone') {
				for (const tv of tvSockets()) {
					send(tv, { jsonrpc: '2.0', method: remoteDisconnectedNotification.method });
				}
			}
		});
	});
}

async function onMessage(socket: WebSocket, remoteAddress: string | undefined, data: RawData) {
	let raw: unknown;
	try {
		raw = JSON.parse(data.toString());
	} catch {
		fail(socket, { type: 'authError', message: 'Malformed message' } satisfies AuthError);
		return;
	}

	const state = connections.get(socket);
	if (!state) return;

	if (state.role === 'tv') {
		relayFromTv(socket, data.toString());
		return;
	}

	if (state.role === 'phone') {
		const parsed = phoneToRelaySchema.safeParse(raw);
		if (!parsed.success) {
			fail(socket, { type: 'authError', message: 'Malformed message' } satisfies AuthError);
			return;
		}
		relayFromPhone(socket, state, parsed.data);
		return;
	}

	if (state.role === 'unauth') {
		const parsed = z.union([tvHelloSchema, pairRequestSchema, helloRequestSchema]).safeParse(raw);
		if (!parsed.success) {
			fail(socket, { type: 'authError', message: 'Unexpected message' } satisfies AuthError);
			return;
		}
		const message = parsed.data;

		if (message.type === 'tvHello') {
			if (!isLoopback(remoteAddress)) {
				fail(socket, {
					type: 'authError',
					message: 'TV role is loopback-only'
				} satisfies AuthError);
				return;
			}
			clearHandshakeTimeout(socket);
			connections.set(socket, { role: 'tv' });
			return;
		}

		if (message.type === 'pair') {
			await handlePairRequest(socket, message);
			return;
		}

		if (message.type === 'hello') {
			await handleHelloRequest(socket, message);
			return;
		}
	}

	if (state.role === 'awaiting-response') {
		const parsed = challengeResponseSchema.safeParse(raw);
		if (!parsed.success) {
			fail(socket, { type: 'authError', message: 'Unexpected message' } satisfies AuthError);
			return;
		}
		await handleChallengeResponse(socket, state, parsed.data);
		return;
	}

	fail(socket, { type: 'authError', message: 'Unexpected message' } satisfies AuthError);
}

function relayFromTv(sender: WebSocket, raw: string) {
	for (const socket of tvSockets()) {
		if (socket !== sender && socket.readyState === WebSocket.OPEN) socket.send(raw);
	}
	for (const [socket, state] of phoneSocketsWithKeys()) {
		const { nonce, ciphertext } = encrypt(state.s2cKey, utf8ToBytes(raw));
		send(socket, {
			type: 'enc',
			nonce: toBase64Url(nonce),
			ciphertext: toBase64Url(ciphertext)
		} satisfies Encrypted);
	}
}

function relayFromPhone(
	socket: WebSocket,
	state: Extract<ConnState, { role: 'phone' }>,
	message: PhoneToRelay
) {
	if (message.type !== 'enc') {
		fail(socket, { type: 'authError', message: 'Expected encrypted frame' } satisfies AuthError);
		return;
	}

	let plaintext: string;
	try {
		plaintext = bytesToUtf8(
			decrypt(state.c2sKey, fromBase64Url(message.nonce), fromBase64Url(message.ciphertext))
		);
	} catch {
		fail(socket, { type: 'authError', message: 'Decryption failed' } satisfies AuthError);
		return;
	}

	for (const tv of tvSockets()) {
		if (tv.readyState === WebSocket.OPEN) tv.send(plaintext);
	}
}

// Lets server-side code outside this module (the plugin host, for a
// PhoneAuthHandoff — see plugins/runtime.ts) push a JSON-RPC notification
// straight to whatever phone is currently paired, without going through the
// TV at all. `message` must already be a valid JSON-RPC notification frame
// (`{jsonrpc: '2.0', method, params}`) — construct it from the relevant
// NotificationType's `.method`, the same way the two calls in this file do.
export function sendToPhones(message: { jsonrpc: string; method: string; params?: unknown }) {
	const raw = JSON.stringify(message);
	for (const [socket, state] of phoneSocketsWithKeys()) {
		const { nonce, ciphertext } = encrypt(state.s2cKey, utf8ToBytes(raw));
		send(socket, {
			type: 'enc',
			nonce: toBase64Url(nonce),
			ciphertext: toBase64Url(ciphertext)
		} satisfies Encrypted);
	}
}
