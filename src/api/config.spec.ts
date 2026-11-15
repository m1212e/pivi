import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseImageRef } from '@pivi/sdk/image';
import { parseConfig } from './config';

describe('parseConfig', () => {
	it('is the empty configuration for an empty file', () => {
		expect(parseConfig('')).toEqual({ apps: { suggested: [] } });
	});

	it('reads the suggested apps', () => {
		expect(parseConfig('[apps]\nsuggested = ["ghcr.io/a/b"]').apps.suggested).toEqual([
			'ghcr.io/a/b'
		]);
	});

	it('refuses unknown keys, so a typo does not go unnoticed', () => {
		expect(() => parseConfig('[apps]\nsugested = []')).toThrow();
		expect(() => parseConfig('[app]\nsuggested = []')).toThrow();
	});

	it('refuses invalid TOML', () => {
		expect(() => parseConfig('[apps\n')).toThrow();
	});

	it("accepts the repository's pivi.toml, with image references only", () => {
		const { apps } = parseConfig(readFileSync('pivi.toml', 'utf8'));
		expect(apps.suggested.length).toBeGreaterThan(0);
		for (const image of apps.suggested) expect(() => parseImageRef(image)).not.toThrow();
	});
});
