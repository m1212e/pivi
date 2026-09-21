// Phone-side driver for the pairing/reconnect handshake described in the
// pairing plan and implemented server-side in src/api/ws/relay.ts. Runs the
// signed-ephemeral-DH reconnect handshake (and, the first time, the pairing
// exchange that precedes it), then hands back a send/onMessage API that
// transparently AEAD-wraps every control message.
import { PAIRING_WS_PORT } from '#lib/wsConfig';
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
	getDeviceCredentials,
	setDeviceCredentials,
	type DeviceCredentials
} from '#lib/state/deviceCredentials';
import type { PhoneToRelay, RelayToPhone } from './protocol';

export type RemoteSession = {
	send: (message: Record<string, unknown>) => void;
	close: () => void;
};

export type RemoteSessionCallbacks = {
	onMessage: (message: Record<string, unknown>) => void;
	onClose: () => void;
};

// null return means "nothing to connect with" — no stored device and no
// pairing token in the URL. The caller shows a "not paired" state.
export async function connectRemoteSession(
	token: string | null,
	callbacks: RemoteSessionCallbacks
): Promise<RemoteSession | null> {
	let credentials = await getDeviceCredentials();
	if (!credentials && !token) return null;

	const socket = new WebSocket(`ws://${location.hostname}:${PAIRING_WS_PORT}`);
	await waitForOpen(socket);

	if (!credentials) {
		credentials = await pair(socket, token!);
		await setDeviceCredentials(credentials);
	}

	const { c2sKey, s2cKey } = await reconnect(socket, credentials);

	socket.addEventListener('message', (event) => {
		const message = safeParse(event.data);
		if (!message || message.type !== 'enc') return;
		if (typeof message.nonce !== 'string' || typeof message.ciphertext !== 'string') return;
		try {
			const plaintext = bytesToUtf8(
				decrypt(s2cKey, fromBase64Url(message.nonce), fromBase64Url(message.ciphertext))
			);
			callbacks.onMessage(JSON.parse(plaintext));
		} catch {
			// Malformed/undecryptable frame — drop it rather than crash the session.
		}
	});
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

	const challenge = await nextMessage(socket);
	if (challenge.type === 'authError') throw new Error(challenge.message);
	if (challenge.type !== 'challenge') throw new Error('Unexpected response to hello');

	const relayEphemeralPublicKey = fromBase64Url(challenge.ephemeralPublicKey);
	const transcript = concatBytes(
		ephemeral.publicKey,
		relayEphemeralPublicKey,
		utf8ToBytes(credentials.deviceId)
	);
	if (!verify(credentials.tvPublicKey, transcript, fromBase64Url(challenge.signature))) {
		throw new Error('This does not appear to be the same TV this device was paired with');
	}

	const sharedSecret = deriveSharedSecret(ephemeral.secretKey, relayEphemeralPublicKey);
	const { c2sKey, s2cKey } = deriveSessionKeys(sharedSecret, transcript);

	sendJson(socket, {
		type: 'response',
		signature: toBase64Url(sign(credentials.deviceSecretKey, transcript))
	});

	const ready = await nextMessage(socket);
	if (ready.type === 'authError') throw new Error(ready.message);
	if (ready.type !== 'ready') throw new Error('Unexpected response to challenge response');

	return { c2sKey, s2cKey };
}

function sendJson(socket: WebSocket, message: PhoneToRelay) {
	socket.send(JSON.stringify(message));
}

function safeParse(data: unknown): Record<string, unknown> | undefined {
	try {
		return JSON.parse(String(data));
	} catch {
		return undefined;
	}
}

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.addEventListener('open', () => resolve(), { once: true });
		socket.addEventListener('error', () => reject(new Error('Could not connect to the TV')), {
			once: true
		});
	});
}

function nextMessage(socket: WebSocket): Promise<RelayToPhone> {
	return new Promise((resolve, reject) => {
		const onMessage = (event: MessageEvent) => {
			cleanup();
			const message = safeParse(event.data);
			if (!message) reject(new Error('Malformed message from the TV'));
			else resolve(message as RelayToPhone);
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
