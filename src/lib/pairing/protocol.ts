// Wire format for the phone<->relay handshake and encrypted control channel.
// Shared between the relay server (src/api/ws/relay.ts) and the phone-side
// session driver (src/lib/pairing/session.ts) so both sides agree on one
// definition instead of duplicating string literals.

// Sent by the TV kiosk tab (src/lib/components/RemoteBridge.svelte)
// immediately after connecting — the relay only accepts this from loopback.
export type TvHello = { type: 'tvHello' };

// First-time pairing: phone presents the scanned token plus its freshly
// generated, permanent device public key.
export type PairRequest = { type: 'pair'; token: string; devicePublicKey: string };
export type PairSuccess = { type: 'paired'; deviceId: string; tvPublicKey: string };
export type PairError = { type: 'pairError'; message: string };

// Reconnect: phone proves it holds the secret key matching a previously
// paired public key, via a fresh signed-ephemeral-DH exchange (mutual auth +
// forward secrecy — see src/lib/crypto/pairing.ts).
export type HelloRequest = { type: 'hello'; deviceId: string; ephemeralPublicKey: string };
export type Challenge = { type: 'challenge'; ephemeralPublicKey: string; signature: string };
export type ChallengeResponse = { type: 'response'; signature: string };
export type Ready = { type: 'ready' };
export type AuthError = { type: 'authError'; message: string };

// Once authenticated, every control/state message (the existing
// move/select/back/key/text/enter/state/requestState messages) is wrapped
// in one of these instead of being sent as bare JSON.
export type Encrypted = { type: 'enc'; nonce: string; ciphertext: string };

export type PhoneToRelay = PairRequest | HelloRequest | ChallengeResponse | Encrypted;
export type RelayToPhone = PairSuccess | PairError | Challenge | Ready | AuthError | Encrypted;
