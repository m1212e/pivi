import { eq } from 'drizzle-orm';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import { PAIRING_WS_PORT } from '#lib/wsConfig';
import {
	bytesToUtf8,
	constantTimeEqual,
	createOpener,
	createSealer,
	decodeFixedLength,
	deriveSessionKeys,
	deriveSharedSecret,
	fromBase64Url,
	generateEphemeralKeypair,
	handshakeTranscript,
	HANDSHAKE_VERSION,
	pairRequestProof,
	pairResponseProof,
	PUBLIC_KEY_BYTES,
	signHandshake,
	SIGNATURE_BYTES,
	toBase64Url,
	utf8ToBytes,
	verifyHandshake
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
	type PairPending,
	type PairRequest,
	type PairSuccess,
	type PhoneToRelay,
	type Ready
} from '#lib/remote/protocol';
import {
	pairingDecisionNotification,
	pairingDecisionParamsSchema,
	pairingRequestClosedNotification,
	pairingRequestNotification,
	remoteConnectedNotification,
	remoteDisconnectedNotification
} from '#lib/remote/remoteProtocol';
import { PHONE_CONNECTION_EVENT, remotePubSub } from './remotePubsub';
import { db } from '../db';
import { pairedDevice } from '../db/schema';
import {
	consumePairingToken,
	getOrCreateTvIdentity,
	pairingTokenFor,
	restorePairingToken
} from '../pairing';

// The pairing relay: the TV's browser and paired phones all connect here. It
// authenticates phones (pair once, then a signed challenge on each reconnect),
// encrypts everything between it and a phone, and forwards messages between
// phones and the TV. It never interprets the app level messages itself.

// Stops half finished handshakes from holding a socket open forever.
const HANDSHAKE_TIMEOUT_MS = 10_000;

// How long a pairing phone waits for the TV to allow it.
const APPROVAL_TIMEOUT_MS = 60_000;

// ws accepts 100 MiB frames by default, far beyond any state push, and an
// unauthenticated socket shouldn't get to make the server buffer that much.
const MAX_FRAME_BYTES = 4 << 20;

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
			phoneEphemeralPublicKey: Uint8Array;
			transcript: Uint8Array;
			relayEphemeralSecretKey: Uint8Array;
	  }
	// Waiting on the TV's approval, nothing the phone sends is expected.
	| { role: 'pairing' }
	| { role: 'tv' }
	| {
			role: 'phone';
			deviceId: string;
			deviceName: string;
			seal: (plaintext: Uint8Array) => Uint8Array;
			open: (ciphertext: Uint8Array) => Uint8Array;
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

// On globalThis because the relay server outlives dev HMR (see
// startPairingRelay). A fresh map per module evaluation would leave its
// handlers filling an old one while hasConnectedPhone reads an empty one.
declare global {
	var __piviRelayConnections: Map<WebSocket, ConnState> | undefined;
}
const connections = (globalThis.__piviRelayConnections ??= new Map<WebSocket, ConnState>());

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

type PendingApproval = { name: string; decide: (approved: boolean) => void };

// Pairing requests the TV hasn't answered yet, by request id. Survives HMR
// like `connections`.
declare global {
	var __piviPendingApprovals: Map<string, PendingApproval> | undefined;
}
const pendingApprovals = (globalThis.__piviPendingApprovals ??= new Map<string, PendingApproval>());

function sendToTvs(method: string, params: unknown) {
	for (const tv of tvSockets()) send(tv, { jsonrpc: '2.0', method, params });
}

// The QR code alone is enough while nobody is using the TV, since the new
// phone is then the only input there is. Once a paired phone is connected,
// whoever holds it decides, so a code photographed off the screen isn't
// enough to take over a TV someone is watching.
function requestApproval(socket: WebSocket, name: string): Promise<boolean> {
	const requestId = crypto.randomUUID();
	send(socket, { type: 'pairPending' } satisfies PairPending);

	return new Promise((resolve) => {
		const decide = (approved: boolean) => {
			if (!pendingApprovals.delete(requestId)) return;
			clearTimeout(timer);
			socket.off('close', onClose);
			sendToTvs(pairingRequestClosedNotification.method, { requestId });
			resolve(approved);
		};
		const onClose = () => decide(false);
		const timer = setTimeout(() => decide(false), APPROVAL_TIMEOUT_MS);
		socket.once('close', onClose);
		pendingApprovals.set(requestId, { name, decide });
		sendToTvs(pairingRequestNotification.method, { requestId, name });
	});
}

// A TV tab that (re)connects mid request still gets to show the prompt.
function announcePendingApprovals(tv: WebSocket) {
	for (const [requestId, { name }] of pendingApprovals) {
		send(tv, {
			jsonrpc: '2.0',
			method: pairingRequestNotification.method,
			params: { requestId, name }
		});
	}
}

// True when `raw` was the TV answering a pairing request. It's consumed here,
// so it never reaches a phone.
function handlePairingDecision(raw: string): boolean {
	if (!raw.includes(pairingDecisionNotification.method)) return false;
	let message: unknown;
	try {
		message = JSON.parse(raw);
	} catch {
		return false;
	}
	const { method, params } = (message ?? {}) as { method?: unknown; params?: unknown };
	if (method !== pairingDecisionNotification.method) return false;
	const parsed = pairingDecisionParamsSchema.safeParse(params);
	if (parsed.success) pendingApprovals.get(parsed.data.requestId)?.decide(parsed.data.approved);
	return true;
}

// First contact from a new phone: trades proof of the QR code's token for a
// device id and the TV's public key, so the phone can verify the relay from
// then on.
async function handlePairRequest(
	socket: WebSocket,
	message: PairRequest,
	userAgent: string | undefined
) {
	const token = pairingTokenFor(message.tokenId);
	const devicePublicKey = decodeFixedLength(message.devicePublicKey, PUBLIC_KEY_BYTES);
	const proof = decodeFixedLength(message.proof, 32);
	const proven =
		token !== undefined &&
		devicePublicKey !== undefined &&
		proof !== undefined &&
		constantTimeEqual(proof, pairRequestProof(token, devicePublicKey));
	// Claimed before the first await, so two phones racing with the same
	// token can't both get through.
	const expiresAt = proven ? consumePairingToken(token) : undefined;
	if (!token || !devicePublicKey || expiresAt === undefined) {
		fail(socket, {
			type: 'pairError',
			message: 'Pairing code expired or already used'
		} satisfies PairError);
		return;
	}

	const name = deriveDeviceName(userAgent);
	if (hasConnectedPhone()) {
		// The prompt can take longer than the handshake timeout allows.
		clearHandshakeTimeout(socket);
		connections.set(socket, { role: 'pairing' });
		const approved = await requestApproval(socket, name);
		if (!approved) {
			fail(socket, {
				type: 'pairError',
				message: 'Pairing was declined on the TV'
			} satisfies PairError);
			return;
		}
	}

	let row;
	let tvIdentity;
	try {
		tvIdentity = await getOrCreateTvIdentity();
		[row] = await db
			.insert(pairedDevice)
			.values({ publicKey: toBase64Url(devicePublicKey), name })
			.returning();
	} catch (error) {
		// A transient failure shouldn't burn the still displayed QR code.
		restorePairingToken(token, expiresAt);
		throw error;
	}

	clearHandshakeTimeout(socket);
	connections.set(socket, { role: 'unauth', timeout: startHandshakeTimeout(socket), userAgent });

	send(socket, {
		type: 'paired',
		deviceId: row.id,
		tvPublicKey: toBase64Url(tvIdentity.publicKey),
		proof: toBase64Url(pairResponseProof(token, devicePublicKey, tvIdentity.publicKey, row.id))
	} satisfies PairSuccess);
}

// A paired phone reconnecting. The relay proves it is the TV by signing a
// transcript, mutual proof of identity before any keys are derived.
async function handleHelloRequest(socket: WebSocket, message: HelloRequest) {
	const { deviceId } = message;
	const phoneEphemeralPublicKey = decodeFixedLength(message.ephemeralPublicKey, PUBLIC_KEY_BYTES);
	if (!phoneEphemeralPublicKey) {
		fail(socket, { type: 'authError', message: 'Malformed message' } satisfies AuthError);
		return;
	}

	const device = await db.query.pairedDevice.findFirst({ where: { id: deviceId } });
	if (!device) {
		fail(socket, { type: 'authError', message: 'Unknown device' } satisfies AuthError);
		return;
	}

	const tvIdentity = await getOrCreateTvIdentity();
	const devicePublicKey = fromBase64Url(device.publicKey);
	const relayEphemeral = generateEphemeralKeypair();
	const transcript = handshakeTranscript({
		phoneEphemeralPublicKey,
		relayEphemeralPublicKey: relayEphemeral.publicKey,
		devicePublicKey,
		tvPublicKey: tvIdentity.publicKey,
		deviceId
	});

	clearHandshakeTimeout(socket);
	connections.set(socket, {
		role: 'awaiting-response',
		timeout: startHandshakeTimeout(socket),
		deviceId,
		deviceName: device.name ?? deriveDeviceName(undefined),
		devicePublicKey,
		phoneEphemeralPublicKey,
		transcript,
		relayEphemeralSecretKey: relayEphemeral.secretKey
	});

	send(socket, {
		type: 'challenge',
		ephemeralPublicKey: toBase64Url(relayEphemeral.publicKey),
		signature: toBase64Url(signHandshake(tvIdentity.secretKey, 'tv', transcript))
	} satisfies Challenge);
}

// Final handshake step: the phone proves it holds its device key, then both
// sides get matching session keys.
async function handleChallengeResponse(
	socket: WebSocket,
	state: Extract<ConnState, { role: 'awaiting-response' }>,
	message: ChallengeResponse
) {
	const signature = decodeFixedLength(message.signature, SIGNATURE_BYTES);
	if (!signature || !verifyHandshake(state.devicePublicKey, 'phone', state.transcript, signature)) {
		fail(socket, {
			type: 'authError',
			message: 'Signature verification failed'
		} satisfies AuthError);
		return;
	}

	const sharedSecret = deriveSharedSecret(
		state.relayEphemeralSecretKey,
		state.phoneEphemeralPublicKey
	);
	// Directions are named from the phone's perspective: c2s is what the
	// relay decrypts, s2c is what it encrypts, mirrored in session.ts.
	const { c2sKey, s2cKey } = deriveSessionKeys(sharedSecret, state.transcript);

	clearHandshakeTimeout(socket);
	connections.set(socket, {
		role: 'phone',
		deviceId: state.deviceId,
		deviceName: state.deviceName,
		seal: createSealer(s2cKey),
		open: createOpener(c2sKey)
	});
	// Right after the role switch, with no await in between: TV traffic is
	// relayed to this socket from now on, and the phone must see 'ready'
	// before its first encrypted frame.
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

	await db
		.update(pairedDevice)
		.set({ lastSeenAt: new Date() })
		.where(eq(pairedDevice.id, state.deviceId));
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

	const wss = new WebSocketServer({ port: PAIRING_WS_PORT, maxPayload: MAX_FRAME_BYTES });

	wss.on('connection', (socket, request) => {
		const remoteAddress = request.socket.remoteAddress;
		const userAgent = request.headers['user-agent'];
		connections.set(socket, { role: 'unauth', timeout: startHandshakeTimeout(socket), userAgent });

		socket.on('message', (data: RawData) => {
			// An unexpected throw would otherwise be an unhandled rejection,
			// which takes the whole server down with it.
			onMessage(socket, remoteAddress, userAgent, data).catch((error: unknown) => {
				console.error('pairing relay: dropping a socket after an error', error);
				fail(socket, { type: 'authError', message: 'Internal error' } satisfies AuthError);
			});
		});
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
	if (state.role === 'pairing') {
		fail(socket, { type: 'authError', message: 'Unexpected message' } satisfies AuthError);
		return;
	}
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
	if (isOutdatedHandshake(raw)) {
		fail(socket, {
			type: 'authError',
			message: 'The TV was updated, reload this page'
		} satisfies AuthError);
		return;
	}
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

// A remote page cached from an older release speaks a handshake this relay no
// longer accepts. Telling it apart from a malformed frame lets the phone show
// something actionable, and keeps it from discarding its credentials.
function isOutdatedHandshake(raw: unknown): boolean {
	if (typeof raw !== 'object' || raw === null) return false;
	const { type, version } = raw as { type?: unknown; version?: unknown };
	return (type === 'pair' || type === 'hello') && version !== HANDSHAKE_VERSION;
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
	announcePendingApprovals(socket);
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
	if (handlePairingDecision(raw)) return;
	broadcastToTvs(raw, sender);
	sendEncrypted(raw);
}

// `undefined` on failure, same contract as parseFrame above.
function decryptFromPhone(
	socket: WebSocket,
	state: Extract<ConnState, { role: 'phone' }>,
	message: Extract<PhoneToRelay, { type: 'enc' }>
): string | undefined {
	try {
		return bytesToUtf8(state.open(fromBase64Url(message.ciphertext)));
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
	sendEncrypted(JSON.stringify(message));
}

function sendEncrypted(raw: string) {
	for (const [socket, state] of phoneSocketsWithKeys()) {
		// A closed socket would never get this frame, and sealing it anyway
		// would only skip a counter for a session that is already over.
		if (socket.readyState !== WebSocket.OPEN) continue;
		send(socket, {
			type: 'enc',
			ciphertext: toBase64Url(state.seal(utf8ToBytes(raw)))
		} satisfies Encrypted);
	}
}
