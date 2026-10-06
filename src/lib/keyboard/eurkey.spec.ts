import { describe, expect, it } from 'vitest';
import { composeDead, EURKEY_ROWS, layerIndex } from './eurkey';

describe('composeDead', () => {
	it('composes accents with letters', () => {
		expect(composeDead('acute', 'e')).toBe('é');
		expect(composeDead('diaeresis', 'U')).toBe('Ü');
		expect(composeDead('tilde', 'n')).toBe('ñ');
		expect(composeDead('caron', 'c')).toBe('č');
	});

	it('prints the bare accent when nothing composes', () => {
		expect(composeDead('acute', 'x')).toBe('´x');
		expect(composeDead('grave', ' ')).toBe('`');
	});
});

describe('layout', () => {
	it('has four layers on every key', () => {
		for (const row of EURKEY_ROWS) for (const key of row) expect(key).toHaveLength(4);
	});

	it('maps modifiers to layers', () => {
		expect(layerIndex(false, false)).toBe(0);
		expect(layerIndex(true, false)).toBe(1);
		expect(layerIndex(false, true)).toBe(2);
		expect(layerIndex(true, true)).toBe(3);
	});
});
