// Phone side of the pairing handshake that src/api/ws/relay.ts serves. Lets
// remoteController.svelte.ts talk to the TV without knowing about pairing,
// key exchange or encryption.
import { pairingSocketUrl } from '#lib/wsConfig';
import {
	bytesToUtf8,
	concatBytes,
	decrypt,
	deriveSessionKeys,
	deriveSharedSecret,
	encrypt,
	fromBase64Url,
	generateEphemeralKeypair,
	generateIdentityKeypair,
	sign,
	toBase64Url,
	utf8ToBytes,
	verify
} from '#lib/crypto/pairing';
import {
	clearDeviceCredentials,
	getDeviceCredentials,
	setDeviceCredentials,
	type DeviceCredentials
} from '#lib/state/deviceCredentials';
import {
	encryptedSchema,
	relayToPhoneSchema,
	type Challenge,
	type PhoneToRelay,
	type RelayToPhone
} from './protocol';

// What callers get once the handshake is done. Encryption stays hidden behind it.
export type RemoteSession = {
	send: (message: Record<string, unknown>) => void;
	close: () => void;
};

// Plaintext in, so the caller can feed it straight into its JSON-RPC reader.
export type RemoteSessionCallbacks = {
	onMessage: (message: Record<string, unknown>) => void;
	onClose: () => void;
};

// The stored credentials no longer match the TV, in practice because its
// database was reset while this phone kept its deviceId. Kept apart from other
// failures because it's the one establishKeys recovers from by pairing again.
class StaleCredentialsError extends Error {}

// One key per direction, so a message can't be replayed back at its sender.
type SessionKeys = { c2sKey: Uint8Array; s2cKey: Uint8Array };

// Turns the one recoverable failure into a value so establishKeys can branch on it.
async function reconnectOrClearStale(
	socket: WebSocket,
	credentials: DeviceCredentials
): Promise<SessionKeys | 'stale'> {
	try {
		return await reconnect(socket, credentials);
	} catch (err) {
		if (!(err instanceof StaleCredentialsError)) throw err;
		return 'stale';
	}
}

// Establishes session keys on `initialSocket`, self-healing once if stored
// credentials turn out to be stale (see StaleCredentialsError's own comment).
async function establishKeys(
	initialSocket: WebSocket,
	credentials: DeviceCredentials | null,
	token: string | null
): Promise<{ socket: WebSocket; keys: SessionKeys } | null> {
	let socket = initialSocket;

	if (credentials) {
		const result = await reconnectOrClearStale(socket, credentials);
		if (result !== 'stale') return { socket, keys: result };

		await clearDeviceCredentials();
		// The relay only tells us the credentials are stale after we've
		// already sent it a 'hello', which moves its connection state past
		// 'unauth', it won't accept a 'pair' message on this same socket
		// anymore, so recovering means starting over with a fresh one.
		socket.close();
		// Nothing left to recover with, same as never having paired.
		if (!token) return null;
		socket = await openSocket();
	}

	const paired = await pair(socket, token!);
	await setDeviceCredentials(paired);
	return { socket, keys: await reconnect(socket, paired) };
}

// Decrypts incoming frames and hands them to the caller.
function attachMessageListener(
	socket: WebSocket,
	s2cKey: Uint8Array,
	onMessage: RemoteSessionCallbacks['onMessage']
) {
	socket.addEventListener('message', (event) => {
		const parsed = encryptedSchema.safeParse(safeParse(event.data));
		if (!parsed.success) return;
		const message = parsed.data;
		try {
			const plaintext = bytesToUtf8(
				decrypt(s2cKey, fromBase64Url(message.nonce), fromBase64Url(message.ciphertext))
			);
			onMessage(JSON.parse(plaintext));
		} catch {
			// Malformed/undecryptable frame, drop it rather than crash the session.
		}
	});
}

/**
 * Entry point for the phone remote page. Returns null when there is nothing to
 * connect with (no stored device and no pairing token in the URL), which the
 * caller shows as a "not paired" state.
 */
export async function connectRemoteSession(
	token: string | null,
	callbacks: RemoteSessionCallbacks
): Promise<RemoteSession | null> {
	const credentials = await getDeviceCredentials();
	if (!credentials && !token) return null;

	const established = await establishKeys(await openSocket(), credentials, token);
	if (!established) return null;
	const { socket, keys } = established;
	const { c2sKey, s2cKey } = keys;

	attachMessageListener(socket, s2cKey, callbacks.onMessage);
	socket.addEventListener('close', callbacks.onClose);

	return {
		send: (message) => {
			if (socket.readyState !== WebSocket.OPEN) return;
			const { nonce, ciphertext } = encrypt(c2sKey, utf8ToBytes(JSON.stringify(message)));
			sendJson(socket, {
				type: 'enc',
				nonce: toBase64Url(nonce),
				ciphertext: toBase64Url(ciphertext)
			});
		},
		close: () => socket.close()
	};
}

// Trades the QR token for a permanent device identity, first visit only.
// Stores nothing itself, the caller persists the credentials.
async function pair(socket: WebSocket, token: string): Promise<DeviceCredentials> {
	const identity = generateIdentityKeypair();
	sendJson(socket, { type: 'pair', token, devicePublicKey: toBase64Url(identity.publicKey) });

	const response = await nextMessage(socket);
	if (response.type === 'pairError') throw new Error(response.message);
	if (response.type !== 'paired') throw new Error('Unexpected response to pairing request');

	return {
		deviceId: response.deviceId,
		deviceSecretKey: identity.secretKey,
		tvPublicKey: fromBase64Url(response.tvPublicKey)
	};
}

// Mutual auth with fresh ephemeral keys, so a recorded session can't be
// decrypted later even if a long term key leaks.
async function reconnect(
	socket: WebSocket,
	credentials: DeviceCredentials
): Promise<{ c2sKey: Uint8Array; s2cKey: Uint8Array }> {
	const ephemeral = generateEphemeralKeypair();
	sendJson(socket, {
		type: 'hello',
		deviceId: credentials.deviceId,
		ephemeralPublicKey: toBase64Url(ephemeral.publicKey)
	});

	const challenge = expectChallenge(await nextMessage(socket));

	const relayEphemeralPublicKey = fromBase64Url(challenge.ephemeralPublicKey);
	const transcript = concatBytes(
		ephemeral.publicKey,
		relayEphemeralPublicKey,
		utf8ToBytes(credentials.deviceId)
	);
	if (!verify(credentials.tvPublicKey, transcript, fromBase64Url(challenge.signature))) {
		// Same reset scenario, just caught client-side instead: the paired
		// device row survived but the TV's own identity keypair didn't, so
		// the signature no longer matches the TV public key we have stored.
		throw new StaleCredentialsError(
			'This does not appear to be the same TV this device was paired with'
		);
	}

	const sharedSecret = deriveSharedSecret(ephemeral.secretKey, relayEphemeralPublicKey);
	const { c2sKey, s2cKey } = deriveSessionKeys(sharedSecret, transcript);

	sendJson(socket, {
		type: 'response',
		signature: toBase64Url(sign(credentials.deviceSecretKey, transcript))
	});

	expectReady(await nextMessage(socket));

	return { c2sKey, s2cKey };
}

// Response checks for reconnect(), split out so its key exchange reads straight through.
function expectChallenge(message: RelayToPhone): Challenge {
	if (message.type === 'authError') {
		// The relay only sends this specific message when the deviceId isn't
		// in its pairedDevice table at all, the one way that happens for a
		// device we ourselves stored credentials for is the TV's database
		// having been reset since.
		if (message.message === 'Unknown device') throw new StaleCredentialsError(message.message);
		throw new Error(message.message);
	}
	if (message.type !== 'challenge') throw new Error('Unexpected response to hello');
	return message;
}

function expectReady(message: RelayToPhone): void {
	if (message.type === 'authError') throw new Error(message.message);
	if (message.type !== 'ready') throw new Error('Unexpected response to challenge response');
}

function sendJson(socket: WebSocket, message: PhoneToRelay) {
	socket.send(JSON.stringify(message));
}

// Network input is untrusted, so a bad frame becomes undefined for the schema to reject.
function safeParse(data: unknown): Record<string, unknown> | undefined {
	try {
		return JSON.parse(String(data));
	} catch {
		return undefined;
	}
}

async function openSocket(): Promise<WebSocket> {
	const socket = new WebSocket(pairingSocketUrl());
	await waitForOpen(socket);
	return socket;
}

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.addEventListener('open', () => resolve(), { once: true });
		socket.addEventListener('error', () => reject(new Error('Could not connect to the TV')), {
			once: true
		});
	});
}

// The handshake is strictly request then reply, so awaiting one message at a time is enough.
function nextMessage(socket: WebSocket): Promise<RelayToPhone> {
	return new Promise((resolve, reject) => {
		const onMessage = (event: MessageEvent) => {
			cleanup();
			const parsed = relayToPhoneSchema.safeParse(safeParse(event.data));
			if (!parsed.success) reject(new Error('Malformed message from the TV'));
			else resolve(parsed.data);
		};
		const onClose = () => {
			cleanup();
			reject(new Error('Connection closed during handshake'));
		};
		const cleanup = () => {
			socket.removeEventListener('message', onMessage);
			socket.removeEventListener('close', onClose);
		};
		socket.addEventListener('message', onMessage);
		socket.addEventListener('close', onClose);
	});
}
