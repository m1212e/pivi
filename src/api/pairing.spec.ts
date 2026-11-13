import { describe, expect, it, vi } from 'vitest';
import { pairingTokenId } from '#lib/crypto/pairing';

// Only the in-memory token store is under test, not the TV identity row.
vi.mock('./db', () => ({ db: {} }));

const {
	consumePairingToken,
	createPairingToken,
	isPairingTokenValid,
	pairingTokenFor,
	restorePairingToken
} = await import('./pairing');

describe('pairing tokens', () => {
	it('is found by its id, the only thing a phone sends', () => {
		const token = createPairingToken();
		expect(pairingTokenFor(pairingTokenId(token))).toBe(token);
		expect(pairingTokenFor(token)).toBeUndefined();
	});

	it('can be consumed once', () => {
		const token = createPairingToken();
		expect(consumePairingToken(token)).toBeTypeOf('number');
		expect(consumePairingToken(token)).toBeUndefined();
		expect(isPairingTokenValid(token)).toBe(false);
	});

	it('comes back after a failure that was not the phone’s fault', () => {
		const token = createPairingToken();
		const expiresAt = consumePairingToken(token)!;
		restorePairingToken(token, expiresAt);
		expect(isPairingTokenValid(token)).toBe(true);
	});

	it('keeps only a bounded number of open tokens', () => {
		const first = createPairingToken();
		for (let i = 0; i < 100; i++) createPairingToken();
		expect(isPairingTokenValid(first)).toBe(false);
	});
});
