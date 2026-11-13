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

// Keys, signatures and proofs are base64url of a few dozen bytes. The cap only
// keeps junk from being decoded, session.ts and relay.ts check exact lengths.
const encoded = z.string().max(128);

// Rejected by the relay with a "reload" hint when it doesn't match, see
// HANDSHAKE_VERSION in src/lib/crypto/pairing.ts.
const version = z.number().int();

// First-time pairing: the phone names the scanned token by its id, never the
// token itself, and proves it knows it with a MAC over its freshly generated,
// permanent device public key.
export const pairRequestSchema = z.object({
	type: z.literal('pair'),
	version,
	tokenId: encoded,
	devicePublicKey: encoded,
	proof: encoded
});
export type PairRequest = z.infer<typeof pairRequestSchema>;

// Relay's answer to a valid token: the id to reconnect with and the TV key to
// verify it by, MACed with the same token so a man in the middle can't swap it.
const pairSuccessSchema = z.object({
	type: z.literal('paired'),
	deviceId: z.string(),
	tvPublicKey: z.string(),
	proof: z.string()
});
export type PairSuccess = z.infer<typeof pairSuccessSchema>;

// Another phone is connected, so the relay is waiting for the TV to allow this one.
const pairPendingSchema = z.object({ type: z.literal('pairPending') });
export type PairPending = z.infer<typeof pairPendingSchema>;

// Expired or already used token, or declined on the TV. The message ends up on the phone as is.
const pairErrorSchema = z.object({ type: z.literal('pairError'), message: z.string() });
export type PairError = z.infer<typeof pairErrorSchema>;

// Reconnect: phone proves it holds the secret key matching a previously
// paired public key, via a fresh signed-ephemeral-DH exchange (mutual auth +
// forward secrecy, see src/lib/crypto/pairing.ts).
export const helloRequestSchema = z.object({
	type: z.literal('hello'),
	version,
	deviceId: z.string().max(64),
	ephemeralPublicKey: encoded
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
	signature: encoded
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
// in one of these instead of being sent as bare JSON. No nonce on the wire,
// both ends count frames per direction (createSealer in crypto/pairing.ts).
export const encryptedSchema = z.object({
	type: z.literal('enc'),
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
	pairPendingSchema,
	pairErrorSchema,
	challengeSchema,
	readySchema,
	authErrorSchema,
	encryptedSchema
]);
export type RelayToPhone = z.infer<typeof relayToPhoneSchema>;
