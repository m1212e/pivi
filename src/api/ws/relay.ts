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
import { PHONE_CONNECTION_EVENT, remotePubSub } from './remotePubsub';
import { db } from '../db';
import { pairedDevice } from '../db/schema';
import { consumePairingToken, getOrCreateTvIdentity, isPairingTokenValid } from '../pairing';

// The pairing relay: the TV's browser and paired phones all connect here. It
// authenticates phones (pair once, then a signed challenge on each reconnect),
// encrypts everything between it and a phone, and forwards messages between
// phones and the TV. It never interprets the app level messages itself.

// Stops half finished handshakes from holding a socket open forever.
const HANDSHAKE_TIMEOUT_MS = 10_000;

// What a socket is allowed to do depends on how far its handshake got, so the
// state is a union keyed by role. Only `phone` holds session keys.
type ConnState =
	| { role: 'unauth'; timeout: ReturnType<typeof setTimeout>; userAgent: string | undefined }
	| {
			role: 'awaiting-response';
			timeout: ReturnType<typeof setTimeout>;
			deviceId: string;
			deviceName: string;
			devicePublicKey: Uint8Array;
			transcript: Uint8Array;
			relayEphemeralSecretKey: Uint8Array;
	  }
	| { role: 'tv' }
	| {
			role: 'phone';
			deviceId: string;
			deviceName: string;
			c2sKey: Uint8Array;
			s2cKey: Uint8Array;
	  };

// Names a phone for the TV's "connected" toast from its User-Agent, without
// pulling in a UA parsing dependency. Unknown UAs fall back to "Phone".
const UA_DEVICE_PATTERNS: readonly (readonly [RegExp, string])[] = [
	[/iPad/, 'iPad'],
	[/iPhone/, 'iPhone']
];

// Android UAs put the model right before "Build/",
// e.g. `Android 14; Pixel 8 Pro Build/...)`.
function androidModelFrom(userAgent: string): string | undefined {
	return userAgent.match(/Android [^;]+;\s*([^;)]+?)\s*(?:Build\/[^)]*)?\)/)?.[1].trim();
}

function deriveDeviceName(userAgent: string | undefined): string {
	if (!userAgent) return 'Phone';
	const known = UA_DEVICE_PATTERNS.find(([pattern]) => pattern.test(userAgent));
	if (known) return known[1];
	return androidModelFrom(userAgent) ?? 'Phone';
}

// Module level so every handler and the exported helpers see the same sockets.
const connections = new Map<WebSocket, ConnState>();

function send(socket: WebSocket, message: object) {
	if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function isLoopback(address: string | undefined) {
	return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// Handshake errors are final, so the socket is closed rather than retried.
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

/**
 * Backs the TV's `phoneConnection` query and lets `openUrlOnPhone` fail loudly
 * when no phone would receive it (handlers/remote.ts).
 */
export function hasConnectedPhone(): boolean {
	return phoneSocketsWithKeys().length > 0;
}

// First contact from a new phone: trades the QR code's token for a device id
// and the TV's public key, so the phone can verify the relay from then on.
async function handlePairRequest(
	socket: WebSocket,
	message: PairRequest,
	userAgent: string | undefined
) {
	const { token, devicePublicKey } = message;
	if (!isPairingTokenValid(token)) {
		fail(socket, {
			type: 'pairError',
			message: 'Pairing code expired or already used'
		} satisfies PairError);
		return;
	}

	const tvIdentity = await getOrCreateTvIdentity();
	const [row] = await db
		.insert(pairedDevice)
		.values({ publicKey: devicePublicKey, name: deriveDeviceName(userAgent) })
		.returning();

	// Only burn the token once pairing has actually succeeded, so a
	// transient failure above doesn't permanently invalidate the still
	// displayed QR code.
	consumePairingToken(token);

	clearHandshakeTimeout(socket);
	connections.set(socket, { role: 'unauth', timeout: startHandshakeTimeout(socket), userAgent });

	send(socket, {
		type: 'paired',
		deviceId: row.id,
		tvPublicKey: toBase64Url(tvIdentity.publicKey)
	} satisfies PairSuccess);
}

// A paired phone reconnecting. The relay proves it is the TV by signing a
// transcript, mutual proof of identity before any keys are derived.
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
		deviceName: device.name ?? deriveDeviceName(undefined),
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

// Final handshake step: the phone proves it holds its device key, then both
// sides get matching session keys.
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
	// relay decrypts, s2c is what it encrypts, mirrored in session.ts.
	const { c2sKey, s2cKey } = deriveSessionKeys(sharedSecret, state.transcript);

	clearHandshakeTimeout(socket);
	connections.set(socket, {
		role: 'phone',
		deviceId: state.deviceId,
		deviceName: state.deviceName,
		c2sKey,
		s2cKey
	});
	await db
		.update(pairedDevice)
		.set({ lastSeenAt: new Date() })
		.where(eq(pairedDevice.id, state.deviceId));

	send(socket, { type: 'ready' } satisfies Ready);

	// Lets RemoteBridge show a toast. Sent directly since relayFromPhone only
	// forwards the phone's own messages, framed as JSON-RPC like everything
	// else on this channel.
	for (const tv of tvSockets()) {
		send(tv, {
			jsonrpc: '2.0',
			method: remoteConnectedNotification.method,
			params: { name: state.deviceName }
		});
	}
	remotePubSub.publish(PHONE_CONNECTION_EVENT);
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

// Guard lives on globalThis because dev HMR re-evaluates this module and a
// second server would fail to bind the same port.
declare global {
	var __piviPairingRelayStarted: boolean | undefined;
}

/**
 * The server phones talk to when used as a remote. Started once from
 * handlers/register.ts, repeat calls are ignored.
 */
export function startPairingRelay() {
	if (globalThis.__piviPairingRelayStarted) return;
	globalThis.__piviPairingRelayStarted = true;

	const wss = new WebSocketServer({ port: PAIRING_WS_PORT });

	wss.on('connection', (socket, request) => {
		const remoteAddress = request.socket.remoteAddress;
		const userAgent = request.headers['user-agent'];
		connections.set(socket, { role: 'unauth', timeout: startHandshakeTimeout(socket), userAgent });

		socket.on('message', (data: RawData) => onMessage(socket, remoteAddress, userAgent, data));
		socket.on('close', () => {
			clearHandshakeTimeout(socket);
			const state = connections.get(socket);
			connections.delete(socket);

			// Only a fully-connected phone leaving is noteworthy, not every
			// dropped socket (e.g. one that never finished the handshake).
			if (state?.role === 'phone') {
				for (const tv of tvSockets()) {
					send(tv, {
						jsonrpc: '2.0',
						method: remoteDisconnectedNotification.method,
						params: { name: state.deviceName }
					});
				}
				remotePubSub.publish(PHONE_CONNECTION_EVENT);
			}
		});
	});
}

// A socket's role decides what a frame means, so each frame goes to exactly
// one per role handler.
async function onMessage(
	socket: WebSocket,
	remoteAddress: string | undefined,
	userAgent: string | undefined,
	data: RawData
) {
	const state = connections.get(socket);
	if (!state) return;
	// TV frames are already JSON-RPC for the phones, so they are relayed as is.
	if (state.role === 'tv') {
		relayFromTv(socket, data.toString());
		return;
	}
	const raw = parseFrame(socket, data);
	if (raw === undefined) return;
	await routeFrame(socket, state, raw, remoteAddress, userAgent);
}

// `undefined` for an unparseable frame. The socket is already failed by then,
// so the caller only has to stop.
function parseFrame(socket: WebSocket, data: RawData): unknown {
	try {
		return JSON.parse(data.toString());
	} catch {
		fail(socket, { type: 'authError', message: 'Malformed message' } satisfies AuthError);
		return undefined;
	}
}

// Not `async`: every branch either finishes synchronously or hands back the
// handler's own promise, which the caller awaits.
function routeFrame(
	socket: WebSocket,
	state: Exclude<ConnState, { role: 'tv' }>,
	raw: unknown,
	remoteAddress: string | undefined,
	userAgent: string | undefined
): void | Promise<void> {
	if (state.role === 'phone') return onPhoneFrame(socket, state, raw);
	if (state.role === 'unauth') return onHandshakeFrame(socket, raw, remoteAddress, userAgent);
	return onChallengeFrame(socket, state, raw);
}

function onPhoneFrame(
	socket: WebSocket,
	state: Extract<ConnState, { role: 'phone' }>,
	raw: unknown
) {
	const parsed = phoneToRelaySchema.safeParse(raw);
	if (!parsed.success) {
		fail(socket, { type: 'authError', message: 'Malformed message' } satisfies AuthError);
		return;
	}
	relayFromPhone(socket, state, parsed.data);
}

// The three things an unauthenticated socket is allowed to say: claim the TV
// role, pair, or say hello as an already-paired phone.
function onHandshakeFrame(
	socket: WebSocket,
	raw: unknown,
	remoteAddress: string | undefined,
	userAgent: string | undefined
): void | Promise<void> {
	const parsed = z.union([tvHelloSchema, pairRequestSchema, helloRequestSchema]).safeParse(raw);
	if (!parsed.success) {
		fail(socket, { type: 'authError', message: 'Unexpected message' } satisfies AuthError);
		return;
	}
	const message = parsed.data;
	if (message.type === 'pair') return handlePairRequest(socket, message, userAgent);
	if (message.type === 'hello') return handleHelloRequest(socket, message);
	acceptTvHello(socket, remoteAddress);
}

// The TV role is what gets to see every phone's decrypted traffic, so it's
// only ever granted to something already running on this machine.
function acceptTvHello(socket: WebSocket, remoteAddress: string | undefined) {
	if (!isLoopback(remoteAddress)) {
		fail(socket, { type: 'authError', message: 'TV role is loopback-only' } satisfies AuthError);
		return;
	}
	clearHandshakeTimeout(socket);
	connections.set(socket, { role: 'tv' });
}

async function onChallengeFrame(
	socket: WebSocket,
	state: Extract<ConnState, { role: 'awaiting-response' }>,
	raw: unknown
) {
	const parsed = challengeResponseSchema.safeParse(raw);
	if (!parsed.success) {
		fail(socket, { type: 'authError', message: 'Unexpected message' } satisfies AuthError);
		return;
	}
	await handleChallengeResponse(socket, state, parsed.data);
}

// `except` keeps a TV tab from getting its own frame back when relaying to
// other TV tabs.
function broadcastToTvs(raw: string, except?: WebSocket) {
	for (const tv of tvSockets()) {
		if (tv !== except && tv.readyState === WebSocket.OPEN) tv.send(raw);
	}
}

// TV traffic is plaintext on the loopback socket, so it is encrypted per phone
// here, and also copied to any other TV.
function relayFromTv(sender: WebSocket, raw: string) {
	broadcastToTvs(raw, sender);
	for (const [socket, state] of phoneSocketsWithKeys()) {
		const { nonce, ciphertext } = encrypt(state.s2cKey, utf8ToBytes(raw));
		send(socket, {
			type: 'enc',
			nonce: toBase64Url(nonce),
			ciphertext: toBase64Url(ciphertext)
		} satisfies Encrypted);
	}
}

// `undefined` on failure, same contract as parseFrame above.
function decryptFromPhone(
	socket: WebSocket,
	state: Extract<ConnState, { role: 'phone' }>,
	message: Extract<PhoneToRelay, { type: 'enc' }>
): string | undefined {
	try {
		return bytesToUtf8(
			decrypt(state.c2sKey, fromBase64Url(message.nonce), fromBase64Url(message.ciphertext))
		);
	} catch {
		fail(socket, { type: 'authError', message: 'Decryption failed' } satisfies AuthError);
		return undefined;
	}
}

// Phone traffic is decrypted here so the TV page never needs session keys.
function relayFromPhone(
	socket: WebSocket,
	state: Extract<ConnState, { role: 'phone' }>,
	message: PhoneToRelay
) {
	if (message.type !== 'enc') {
		fail(socket, { type: 'authError', message: 'Expected encrypted frame' } satisfies AuthError);
		return;
	}
	const plaintext = decryptFromPhone(socket, state, message);
	if (plaintext === undefined) return;
	broadcastToTvs(plaintext);
}

/**
 * Lets server code push a notification to connected phones without the TV
 * page, used by the `openUrlOnPhone` mutation (handlers/remote.ts). Build
 * `message` from a remoteProtocol.ts NotificationType's `.method`.
 */
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
