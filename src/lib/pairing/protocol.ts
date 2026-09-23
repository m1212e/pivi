// Wire format for the phone<->relay handshake and encrypted control channel.
// Shared between the relay server (src/api/ws/relay.ts) and the phone-side
// session driver (src/lib/pairing/session.ts) so both sides agree on one
// definition instead of duplicating string literals.
//
// Every shape is a zod schema (types are derived from it, not the other way
// round) so both sides can validate a message crossing this untrusted
// network boundary at runtime, the same way the plugin RPC/UI boundaries
// already do, instead of trusting a TypeScript cast.
import { z } from 'zod';

// Sent by the TV kiosk tab (src/lib/components/RemoteBridge.svelte)
// immediately after connecting — the relay only accepts this from loopback.
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

const pairSuccessSchema = z.object({
	type: z.literal('paired'),
	deviceId: z.string(),
	tvPublicKey: z.string()
});
export type PairSuccess = z.infer<typeof pairSuccessSchema>;

const pairErrorSchema = z.object({ type: z.literal('pairError'), message: z.string() });
export type PairError = z.infer<typeof pairErrorSchema>;

// Reconnect: phone proves it holds the secret key matching a previously
// paired public key, via a fresh signed-ephemeral-DH exchange (mutual auth +
// forward secrecy — see src/lib/crypto/pairing.ts).
export const helloRequestSchema = z.object({
	type: z.literal('hello'),
	deviceId: z.string(),
	ephemeralPublicKey: z.string()
});
export type HelloRequest = z.infer<typeof helloRequestSchema>;

const challengeSchema = z.object({
	type: z.literal('challenge'),
	ephemeralPublicKey: z.string(),
	signature: z.string()
});
export type Challenge = z.infer<typeof challengeSchema>;

export const challengeResponseSchema = z.object({
	type: z.literal('response'),
	signature: z.string()
});
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;

const readySchema = z.object({ type: z.literal('ready') });
export type Ready = z.infer<typeof readySchema>;

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
