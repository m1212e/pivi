// Wire format for the phone<->relay handshake and encrypted control channel,
// shared by the relay (src/api/ws/relay.ts) and the phone (session.ts) so the
// two can't drift. Zod schemas rather than plain types because both sides
// have to validate what arrives over the network at runtime.
import { z } from 'zod';

// Sent by the TV kiosk tab (src/lib/components/RemoteBridge.svelte)
// immediately after connecting. The relay only accepts this from loopback,
// so a phone can't pose as the TV.
export const tvHelloSchema = z.object({ type: z.literal('tvHello') });
export type TvHello = z.infer<typeof tvHelloSchema>;

// First-time pairing: phone presents the scanned token plus its freshly
// generated, permanent device public key.
export const pairRequestSchema = z.object({
	type: z.literal('pair'),
	token: z.string(),
	devicePublicKey: z.string()
});
export type PairRequest = z.infer<typeof pairRequestSchema>;

// Relay's answer to a valid token: the id to reconnect with and the TV key to verify it by.
const pairSuccessSchema = z.object({
	type: z.literal('paired'),
	deviceId: z.string(),
	tvPublicKey: z.string()
});
export type PairSuccess = z.infer<typeof pairSuccessSchema>;

// Expired or already used token. The message ends up on the phone as is.
const pairErrorSchema = z.object({ type: z.literal('pairError'), message: z.string() });
export type PairError = z.infer<typeof pairErrorSchema>;

// Reconnect: phone proves it holds the secret key matching a previously
// paired public key, via a fresh signed-ephemeral-DH exchange (mutual auth +
// forward secrecy, see src/lib/crypto/pairing.ts).
export const helloRequestSchema = z.object({
	type: z.literal('hello'),
	deviceId: z.string(),
	ephemeralPublicKey: z.string()
});
export type HelloRequest = z.infer<typeof helloRequestSchema>;

// The TV's half of the exchange, signed so the phone knows it is the TV it paired with.
const challengeSchema = z.object({
	type: z.literal('challenge'),
	ephemeralPublicKey: z.string(),
	signature: z.string()
});
export type Challenge = z.infer<typeof challengeSchema>;

// The phone's signature over the same transcript, proving it holds the device key.
export const challengeResponseSchema = z.object({
	type: z.literal('response'),
	signature: z.string()
});
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;

// Handshake done, encrypted traffic may start.
const readySchema = z.object({ type: z.literal('ready') });
export type Ready = z.infer<typeof readySchema>;

// Handshake rejected. session.ts treats 'Unknown device' as stale credentials.
const authErrorSchema = z.object({ type: z.literal('authError'), message: z.string() });
export type AuthError = z.infer<typeof authErrorSchema>;

// Once authenticated, every control/state message (the existing
// move/select/back/key/text/enter/state/requestState messages) is wrapped
// in one of these instead of being sent as bare JSON.
export const encryptedSchema = z.object({
	type: z.literal('enc'),
	nonce: z.string(),
	ciphertext: z.string()
});
export type Encrypted = z.infer<typeof encryptedSchema>;

// Unions per direction so each side only has to accept what the other can send.
export const phoneToRelaySchema = z.union([
	pairRequestSchema,
	helloRequestSchema,
	challengeResponseSchema,
	encryptedSchema
]);
export type PhoneToRelay = z.infer<typeof phoneToRelaySchema>;

export const relayToPhoneSchema = z.union([
	pairSuccessSchema,
	pairErrorSchema,
	challengeSchema,
	readySchema,
	authErrorSchema,
	encryptedSchema
]);
export type RelayToPhone = z.infer<typeof relayToPhoneSchema>;
