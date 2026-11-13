// Drives the real relay over a real socket, acting as the phone with the same
// crypto helpers session.ts uses. The database is an in-memory stand-in.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
	bytesToUtf8,
	createOpener,
	createSealer,
	deriveSessionKeys,
	deriveSharedSecret,
	fromBase64Url,
	generateEphemeralKeypair,
	generateIdentityKeypair,
	handshakeTranscript,
	HANDSHAKE_VERSION,
	pairingTokenId,
	pairRequestProof,
	pairResponseProof,
	signHandshake,
	toBase64Url,
	utf8ToBytes,
	verifyHandshake,
	type Keypair
} from '#lib/crypto/pairing';

const PORT = 25_175 + Math.floor(Math.random() * 1000);
vi.stubEnv('VITE_PIVI_WS_PORT', String(PORT));

vi.mock('../db', async () => {
	const schema = await import('../db/schema');
	const devices = new Map<string, { id: string; publicKey: string; name: string | null }>();
	let tvRow: { id: string; publicKey: string; secretKey: string } | undefined;
	let nextId = 1;
	return {
		db: {
			query: {
				pairedDevice: {
					findFirst: ({ where }: { where: { id: string } }) =>
						Promise.resolve(devices.get(where.id))
				},
				tvIdentity: { findFirst: () => Promise.resolve(tvRow) }
			},
			insert: (table: unknown) => ({
				values: (values: Record<string, string>) => ({
					returning: () => {
						if (table !== schema.pairedDevice) throw new Error('unexpected insert');
						const row = {
							id: `device-${nextId++}`,
							publicKey: values.publicKey,
							name: values.name
						};
						devices.set(row.id, row);
						return Promise.resolve([row]);
					},
					onConflictDoNothing: () => {
						tvRow ??= values as unknown as typeof tvRow;
						return Promise.resolve();
					}
				})
			}),
			update: () => ({ set: () => ({ where: async () => {} }) })
		}
	};
});

const { startPairingRelay } = await import('./relay');
const { createPairingToken, isPairingTokenValid } = await import('../pairing');

type Frame = Record<string, unknown>;

// Collects frames as they arrive, so a test can await the next one without
// racing the socket.
async function connect() {
	const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
	const queue: Frame[] = [];
	const waiting: ((frame: Frame) => void)[] = [];
	let closed = false;
	socket.on('message', (data) => {
		const frame = JSON.parse(data.toString());
		const next = waiting.shift();
		if (next) next(frame);
		else queue.push(frame);
	});
	socket.on('close', () => (closed = true));
	await new Promise((resolve) => socket.once('open', resolve));
	return {
		socket,
		send: (frame: Frame) => socket.send(JSON.stringify(frame)),
		next: () =>
			new Promise<Frame>((resolve) => {
				const queued = queue.shift();
				if (queued) resolve(queued);
				else waiting.push(resolve);
			}),
		closed: () =>
			closed ? Promise.resolve() : new Promise((resolve) => socket.once('close', resolve))
	};
}

type Client = Awaited<ReturnType<typeof connect>>;

// The TV also gets connect and disconnect notices from earlier tests, so
// assertions skip ahead to the frame they care about.
async function nextWithMethod(client: Client, method: string) {
	for (;;) {
		const frame = await client.next();
		if (frame.method === method) return frame;
	}
}

function pair(client: Client, token: string, identity: Keypair, proofToken = token) {
	client.send({
		type: 'pair',
		version: HANDSHAKE_VERSION,
		tokenId: pairingTokenId(token),
		devicePublicKey: toBase64Url(identity.publicKey),
		proof: toBase64Url(pairRequestProof(proofToken, identity.publicKey))
	});
	return client.next();
}

// The phone's half of reconnect(), returning ready to use session ciphers.
async function handshake(client: Client, deviceId: string, identity: Keypair, tvKey: Uint8Array) {
	const ephemeral = generateEphemeralKeypair();
	client.send({
		type: 'hello',
		version: HANDSHAKE_VERSION,
		deviceId,
		ephemeralPublicKey: toBase64Url(ephemeral.publicKey)
	});
	const challenge = (await client.next()) as { ephemeralPublicKey: string; signature: string };
	const relayEphemeral = fromBase64Url(challenge.ephemeralPublicKey);
	const transcript = handshakeTranscript({
		phoneEphemeralPublicKey: ephemeral.publicKey,
		relayEphemeralPublicKey: relayEphemeral,
		devicePublicKey: identity.publicKey,
		tvPublicKey: tvKey,
		deviceId
	});
	expect(verifyHandshake(tvKey, 'tv', transcript, fromBase64Url(challenge.signature))).toBe(true);
	client.send({
		type: 'response',
		signature: toBase64Url(signHandshake(identity.secretKey, 'phone', transcript))
	});
	expect(await client.next()).toEqual({ type: 'ready' });
	const keys = deriveSessionKeys(
		deriveSharedSecret(ephemeral.secretKey, relayEphemeral),
		transcript
	);
	return { seal: createSealer(keys.c2sKey), open: createOpener(keys.s2cKey) };
}

let tv: Client;
const phone = generateIdentityKeypair();
let phoneId: string;
let tvKey: Uint8Array;

beforeAll(async () => {
	startPairingRelay();
	tv = await connect();
	tv.send({ type: 'tvHello' });
});

afterAll(() => tv.socket.close());

describe('the pairing relay', () => {
	it('rejects a pairing proof made without the token', async () => {
		const token = createPairingToken();
		const client = await connect();
		const response = await pair(client, token, generateIdentityKeypair(), 'guessed');
		expect(response).toEqual({ type: 'pairError', message: expect.any(String) });
		// A forged attempt must not burn the code the real phone is about to scan.
		expect(isPairingTokenValid(token)).toBe(true);
	});

	it('pairs a phone that proves it scanned the code, once', async () => {
		const token = createPairingToken();
		const client = await connect();
		const response = (await pair(client, token, phone)) as Record<string, string>;
		expect(response.type).toBe('paired');
		phoneId = response.deviceId;
		tvKey = fromBase64Url(response.tvPublicKey);
		expect(fromBase64Url(response.proof)).toEqual(
			pairResponseProof(token, phone.publicKey, tvKey, phoneId)
		);

		const second = await connect();
		expect((await pair(second, token, generateIdentityKeypair())).type).toBe('pairError');
		client.socket.close();
	});

	it('turns away a remote page from an older release', async () => {
		const client = await connect();
		client.send({ type: 'hello', deviceId: phoneId, ephemeralPublicKey: 'x' });
		expect(await client.next()).toMatchObject({ type: 'authError', message: /reload/ });
	});

	it('survives malformed keys instead of crashing', async () => {
		const client = await connect();
		client.send({
			type: 'hello',
			version: HANDSHAKE_VERSION,
			deviceId: phoneId,
			ephemeralPublicKey: 'not!base64'
		});
		expect(await client.next()).toMatchObject({ type: 'authError' });

		// Still serving afterwards.
		const again = await connect();
		await handshake(again, phoneId, phone, tvKey);
		again.socket.close();
	});

	it('relays encrypted traffic and drops the session on a replayed frame', async () => {
		const client = await connect();
		const { seal, open } = await handshake(client, phoneId, phone, tvKey);
		await nextWithMethod(tv, 'remote/remoteConnected');

		const frame = { type: 'enc', ciphertext: toBase64Url(seal(utf8ToBytes('{"method":"x"}'))) };
		client.send(frame);
		expect(await nextWithMethod(tv, 'x')).toEqual({ method: 'x' });

		tv.send({ jsonrpc: '2.0', method: 'remote/state' });
		const encrypted = (await client.next()) as { ciphertext: string };
		expect(JSON.parse(bytesToUtf8(open(fromBase64Url(encrypted.ciphertext))))).toMatchObject({
			method: 'remote/state'
		});

		client.send(frame);
		await client.closed();
		await nextWithMethod(tv, 'remote/remoteDisconnected');
	});

	it('asks the TV before pairing a second phone while one is connected', async () => {
		const first = await connect();
		await handshake(first, phoneId, phone, tvKey);
		await nextWithMethod(tv, 'remote/remoteConnected');

		const token = createPairingToken();
		const newcomer = await connect();
		const pending = pair(newcomer, token, generateIdentityKeypair());
		expect(await pending).toEqual({ type: 'pairPending' });

		const request = (await nextWithMethod(tv, 'remote/pairingRequest')) as {
			params: { requestId: string };
		};
		tv.send({
			jsonrpc: '2.0',
			method: 'remote/pairingDecision',
			params: { requestId: request.params.requestId, approved: false }
		});
		expect(await newcomer.next()).toMatchObject({ type: 'pairError', message: /declined/ });
		await nextWithMethod(tv, 'remote/pairingRequestClosed');
		first.socket.close();
		await nextWithMethod(tv, 'remote/remoteDisconnected');
	});
});
